// 真实组合测试：完整 agent loop + mock adapter 脚本化驱动证伪协议，无网络。
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as FalsificationLoopPlugin from '@deepseek-ai/dsh-popper'
import type { Config } from '@deepseek-ai/dsh-popper'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import type { LedgerEntry } from '../src/types.ts'
import { hashEntry } from '../src/ledger.ts'

const FAIL = 'node -e "process.exit(1)"'
const PASS = 'node -e "process.exit(0)"'

const baseConfig: Config = {
  mode: 'strict',
  riskyTools: ['write_probe'],
  gateRegistry: [
    { id: 'unit', command: FAIL, timeoutMs: 5000 },
  ],
}

async function harness(config: Config, escalate?: 'resume' | 'disarm'): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(FalsificationLoopPlugin, config)
  if (escalate) {
    await ctx.plugin(UserQuestionService)
    ctx.userQuestions.registerProvider({ ask: async () => ({ answers: [{ id: 'fl-escalation', selected: [escalate === 'disarm' ? 'Disarm' : 'Resume'] }] }) })
  }
  ctx.tools.register(defineContentToolFixture({ name: 'write_probe', description: 'w', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => { const d = ctx.on('agent/status', ({ agent: s, status: st }) => { if (s === agent && st === 'idle') { d(); resolve() } }) })
}

function ledgerEvents(agent: Agent): LedgerEntry[] {
  return [...agent.session.events]
    .filter((e): e is SessionEvent<'falsification/ledger'> => e.type === 'falsification/ledger')
    .map(e => e.data)
}

function ledgerEventEnvelopes(agent: Agent): SessionEvent<'falsification/ledger'>[] {
  return [...agent.session.events].filter((e): e is SessionEvent<'falsification/ledger'> => e.type === 'falsification/ledger')
}

function checkLedgerIgnorable(agent: Agent): boolean {
  return ledgerEventEnvelopes(agent).every(e => e.ignorable === true)
}

function loopContexts(agent: Agent): { text: string; summary: string }[] {
  return [...agent.session.events]
    .filter((e): e is SessionEvent<'user/message'> => e.type === 'user/message' && e.data.source.kind === 'plugin' && e.data.source.plugin === 'popper')
    .map(e => {
      const source = e.data.source
      return { text: e.data.content.map(b => b.type === 'text' ? b.text : '').join('|'), summary: source.kind === 'plugin' && source.form === 'notice' ? source.summary : '' }
    })
}

function checkChain(entries: LedgerEntry[]): boolean {
  let prev = ''
  for (const e of entries) {
    if (e.prevHash !== prev) return false
    prev = hashEntry(e)
  }
  return true
}

describe('wiring: strict mode through a real agent loop', () => {
  it('claim -> risky -> gate falsified -> hypotheses -> experiment passed, protocol notices injected', async () => {
    const ctx = await harness(baseConfig)
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'falsification', { action: 'claim', rootCause: 'rc', predictedGateId: 'unit', predictedOutcome: true }),
      toolCallResponse('c2', 'write_probe', {}),
      toolCallResponse('c3', 'falsification', { action: 'hypotheses', hypotheses: [
        { text: 'A', predictedObservable: 'a', experimentCommand: PASS },
        { text: 'B', predictedObservable: 'b', experimentCommand: 'node -e "process.exit(2)"' },
      ] }),
      toolCallResponse('c4', 'falsification', { action: 'experiment', experimentCommand: PASS }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('w1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const entries = ledgerEvents(agent)
    const kinds = entries.map(e => e.kind)
    expect(kinds).toContain('claim')
    expect(kinds).toContain('falsification')
    expect(kinds).toContain('hypotheses')
    expect(kinds).toContain('experiment')
    const gates = entries.filter(e => e.kind === 'gate')
    expect(gates[gates.length - 1]?.verdict).toBe('falsified')
    const experiment = entries.find(e => e.kind === 'experiment')
    expect(experiment?.verdict).toBe('passed')
    expect(checkChain(entries)).toBe(true)
    expect(checkLedgerIgnorable(agent)).toBe(true)

    const notices = loopContexts(agent)
    expect(notices.some(n => n.text.includes('was falsified by gate') && n.text.includes('hypotheses'))).toBe(true)
  })

  it('experiment not in whitelist is rejected with a protocol entry and notice', async () => {
    const ctx = await harness(baseConfig)
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'falsification', { action: 'claim', rootCause: 'rc', predictedGateId: 'unit', predictedOutcome: true }),
      toolCallResponse('c2', 'write_probe', {}),
      toolCallResponse('c3', 'falsification', { action: 'hypotheses', hypotheses: [
        { text: 'A', predictedObservable: 'a', experimentCommand: PASS },
        { text: 'B', predictedObservable: 'b', experimentCommand: 'node -e "process.exit(2)"' },
      ] }),
      toolCallResponse('c4', 'falsification', { action: 'experiment', experimentCommand: 'node -e "process.exit(999)"' }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('w2'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const entries = ledgerEvents(agent)
    expect(entries.some(e => e.kind === 'protocol' && (e.message ?? '').includes('not in whitelist'))).toBe(true)
    const notices = loopContexts(agent)
    expect(notices.some(n => n.text.includes('is not among your selected hypotheses'))).toBe(true)
  })

  it('risky tool without claim is recorded as protocol violation and nudged', async () => {
    const ctx = await harness(baseConfig)
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'write_probe', {}),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('w3'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    const entries = ledgerEvents(agent)
    expect(entries.some(e => e.kind === 'protocol' && (e.message ?? '').includes('without claim'))).toBe(true)
    const notices = loopContexts(agent)
    expect(notices.some(n => n.text.includes('without committing a claim'))).toBe(true)
  })
})

describe('wiring: escalation at frontier exhaustion', () => {
  const bad1 = (n: number) => [{ text: 'only-one-' + n, predictedObservable: 'o', experimentCommand: 'node -e "exit(' + n + ')"' }]
  const frontierConfig: Config = { ...baseConfig, noveltyRejectLimit: 3 }

  it('无应答者（userQuestions 未组合）-> escalation 需求只记录一次，锁存不重问', async () => {
    const ctx = await harness(frontierConfig)
    const adapter = new MockAdapter([
      toolCallResponse('f1', 'falsification', { action: 'claim', rootCause: 'rc', predictedGateId: 'unit', predictedOutcome: true }),
      toolCallResponse('f2', 'write_probe', {}),
      toolCallResponse('f3', 'falsification', { action: 'hypotheses', hypotheses: bad1(3) }),
      toolCallResponse('f4', 'falsification', { action: 'hypotheses', hypotheses: bad1(4) }),
      toolCallResponse('f5', 'falsification', { action: 'hypotheses', hypotheses: bad1(5) }),
      toolCallResponse('f6', 'write_probe', {}),
      toolCallResponse('f7', 'write_probe', {}),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('w5'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const entries = ledgerEvents(agent)
    expect(entries.some(e => e.kind === 'frontier')).toBe(true)
    expect(entries.filter(e => (e.message ?? '').includes('escalation required')).length).toBe(1)
    expect(checkChain(entries)).toBe(true)
  })

  it('有应答者且选 Resume -> 重装备武装，后续 risky 重新受门控，无 escalation 记录', async () => {
    const passConfig: Config = { ...frontierConfig, gateRegistry: [{ id: 'unit', command: PASS, timeoutMs: 5000 }] }
    const ctx = await harness(passConfig, 'resume')
    const adapter = new MockAdapter([
      toolCallResponse('r1', 'falsification', { action: 'claim', rootCause: 'rc', predictedGateId: 'unit', predictedOutcome: false }),
      toolCallResponse('r2', 'write_probe', {}),
      toolCallResponse('r3', 'falsification', { action: 'hypotheses', hypotheses: bad1(3) }),
      toolCallResponse('r4', 'falsification', { action: 'hypotheses', hypotheses: bad1(4) }),
      toolCallResponse('r5', 'falsification', { action: 'hypotheses', hypotheses: bad1(5) }),
      toolCallResponse('r6', 'write_probe', {}),
      toolCallResponse('r7', 'falsification', { action: 'claim', rootCause: 'rc2', predictedGateId: 'unit', predictedOutcome: true }),
      toolCallResponse('r8', 'write_probe', {}),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('w6'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const entries = ledgerEvents(agent)
    expect(entries.some(e => e.kind === 'resume')).toBe(true)
    expect(entries.filter(e => (e.message ?? '').includes('escalation required')).length).toBe(0)
    const gates = entries.filter(e => e.kind === 'gate')
    expect(gates[gates.length - 1]?.verdict).toBe('passed')
    expect(checkChain(entries)).toBe(true)
  })
})

describe('wiring: observe mode records without executing gates', () => {
  it('claim recorded, risky tool and gate skipped, no protocol contexts', async () => {
    const ctx = await harness({ ...baseConfig, mode: 'observe' })
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'falsification', { action: 'claim', rootCause: 'rc', predictedGateId: 'unit', predictedOutcome: true }),
      toolCallResponse('c2', 'write_probe', {}),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('w4'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const entries = ledgerEvents(agent)
    expect(entries.some(e => e.kind === 'claim' && (e.message ?? '').includes('observe: recorded'))).toBe(true)
    expect(entries.some(e => e.kind === 'gate')).toBe(false)
    // observe 不产生任何协议拦截上下文；唯一注入是每会话一次的 status banner
    const contexts = loopContexts(agent)
    expect(contexts.filter(n => n.summary !== 'popper status')).toHaveLength(0)
    expect(contexts.filter(n => n.summary === 'popper status')).toHaveLength(1)
  })

  it('announces the mode banner exactly once per session, on the first tool call', async () => {
    const ctx = await harness(baseConfig)
    const adapter = new MockAdapter([
      toolCallResponse('b1', 'write_probe', {}),
      toolCallResponse('b2', 'write_probe', {}),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('banner1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const notices = loopContexts(agent)
    const banners = notices.filter(n => n.text.startsWith('Popper'))
    expect(banners).toHaveLength(1)
    expect(banners[0]!.text).toContain('armed')
    expect(banners[0]!.text).toContain('Gates: unit')
    // 第二次 risky 调用不再重复 banner，但仍拒绝缺主张
    expect(notices.filter(n => n.summary === 'claim missing')).toHaveLength(2)
  })

  it('observe mode announces observing status once but never gates', async () => {
    const ctx = await harness({ ...baseConfig, mode: 'observe' })
    const adapter = new MockAdapter([
      toolCallResponse('o1', 'write_probe', {}),
      toolCallResponse('o2', 'write_probe', {}),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('banner2'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const notices = loopContexts(agent)
    const banners = notices.filter(n => n.text.startsWith('Popper'))
    expect(banners).toHaveLength(1)
    expect(banners[0]!.text).toContain('observing')
    // observe 模式不产生任何门控：无 claim missing、无协议条目、无 claim
    expect(notices.some(n => n.summary === 'claim missing')).toBe(false)
    const entries = ledgerEvents(agent)
    expect(entries.filter(e => e.kind === 'protocol' || e.kind === 'claim' || e.kind === 'gate')).toHaveLength(0)
  })

})