import { describe, expect, it } from 'vitest'
import { FalsificationLoop } from '../src/state-machine.ts'
import { Ledger } from '../src/ledger.ts'
import type { LoopConfig } from '../src/state-machine.ts'

const config: LoopConfig = {
  mode: 'strict',
  backstopRounds: 6,
  noveltyRejectLimit: 2,
  riskyTools: ['write'],
  gateRegistry: new Map([
    ['typecheck', { command: 'pnpm run typecheck' }],
    ['unit', { command: 'pnpm run test' }],
  ]),
}
const mkLoop = () => new FalsificationLoop(config, new Ledger('t'))

describe('falsification loop', () => {
  it('observe 模式：契约武装前事件只记录，不进门控', () => {
    const observe = new FalsificationLoop({ ...config, mode: 'observe' }, new Ledger('t'))
    observe.handle({ type: 'risky-tool-before', tool: 'write' })
    expect(observe.currentState).toBe('observe')
  })

  it('claim 结构不合格 -> 留在 awaiting-claim，记录 protocol 条目', () => {
    const loop = mkLoop()
    loop.handle({ type: 'contract-armed', actor: 'human' })
    loop.handle({ type: 'risky-tool-before', tool: 'write' })
    const out = loop.handle({ type: 'model-claim', actor: 'model', claim: { id: 'bad', text: '', class: 'hard', assertiveness: 'claim', predictedGateId: 'typecheck', predictedOutcome: true } })
    expect(loop.currentState).toBe('awaiting-claim')
    expect(out[0]!.kind).toBe('protocol')
  })

  it('gate 证伪 -> 互斥假设 -> 判别实验通过 -> gate-passed', () => {
    const loop = mkLoop()
    loop.handle({ type: 'contract-armed', actor: 'human' })
    loop.handle({ type: 'risky-tool-before', tool: 'write' })
    loop.handle({ type: 'model-claim', actor: 'model', claim: { id: 'c', text: 'x', class: 'hard', assertiveness: 'claim', predictedGateId: 'typecheck', predictedOutcome: true } })
    loop.handle({ type: 'tool-result', tool: 'write' })
    loop.handle({ type: 'gate-result', gateId: 'typecheck', result: { ok: false } })
    expect(loop.currentState).toBe('falsified')
    loop.handle({ type: 'model-hypotheses', actor: 'model', hypotheses: [
      { id: 'h1', text: 'A', excludes: ['c'], predictedObservable: 'a', experimentCommand: 'exp-a' },
      { id: 'h2', text: 'B', excludes: ['c'], predictedObservable: 'b', experimentCommand: 'exp-b' },
    ] })
    expect(loop.currentState).toBe('experiment-selected')
    loop.handle({ type: 'experiment-result', experimentCommand: 'exp-b', result: { ok: true } })
    expect(loop.currentState).toBe('armed')
  })

  it('contract-revoked：执行态任意阶段撤销 -> disarmed + disarm 条目', () => {
    const loop = mkLoop()
    loop.handle({ type: 'contract-armed', actor: 'human' })
    loop.handle({ type: 'risky-tool-before', tool: 'write' })
    loop.handle({ type: 'model-claim', actor: 'model', claim: { id: 'c', text: 'x', class: 'hard', assertiveness: 'claim', predictedGateId: 'typecheck', predictedOutcome: true } })
    loop.handle({ type: 'tool-result', tool: 'write' })
    const out = loop.handle({ type: 'contract-revoked' })
    expect(loop.currentState).toBe('disarmed')
    expect(out[0]?.kind).toBe('disarm')
    // 撤销后 gate 结果迟到被忽略
    loop.handle({ type: 'gate-result', gateId: 'typecheck', result: { ok: false } })
    expect(loop.currentState).toBe('disarmed')
  })

  it('resume 复位前沿预算：重置后拒绝计数从零开始', () => {
    const loop = mkLoop()
    loop.handle({ type: 'contract-armed', actor: 'human' })
    loop.handle({ type: 'risky-tool-before', tool: 'write' })
    loop.handle({ type: 'model-claim', actor: 'model', claim: { id: 'c', text: 'x', class: 'hard', assertiveness: 'claim', predictedGateId: 'typecheck', predictedOutcome: true } })
    loop.handle({ type: 'tool-result', tool: 'write' })
    loop.handle({ type: 'gate-result', gateId: 'typecheck', result: { ok: false } })
    const stale = [
      { id: 'h1', text: 'A', excludes: ['c'], predictedObservable: 'a', experimentCommand: 'exp-a' },
      { id: 'h2', text: 'B', excludes: ['c'], predictedObservable: 'b', experimentCommand: 'exp-b' },
    ]
    loop.handle({ type: 'model-hypotheses', actor: 'model', hypotheses: stale })
    loop.handle({ type: 'experiment-result', experimentCommand: 'exp-a', result: { ok: false } })
    loop.handle({ type: 'model-hypotheses', actor: 'model', hypotheses: stale })
    loop.handle({ type: 'model-hypotheses', actor: 'model', hypotheses: stale })
    expect(loop.currentState).toBe('frontier-exhausted')
    loop.handle({ type: 'human-escalation', decision: 'resume' })
    expect(loop.currentState).toBe('armed')
    loop.handle({ type: 'risky-tool-before', tool: 'write' })
    loop.handle({ type: 'model-claim', actor: 'model', claim: { id: 'c2', text: 'x', class: 'hard', assertiveness: 'claim', predictedGateId: 'typecheck', predictedOutcome: true } })
    loop.handle({ type: 'tool-result', tool: 'write' })
    loop.handle({ type: 'gate-result', gateId: 'typecheck', result: { ok: false } })
    loop.handle({ type: 'model-hypotheses', actor: 'model', hypotheses: stale })
    // 复位后仅 1 次拒绝（限 2），仍处 falsified，未再次前沿耗尽
    expect(loop.currentState).toBe('falsified')
  })

  it('重复实验 -> 连续新颖性拒绝 -> 前沿耗尽', () => {
    const loop = mkLoop()
    loop.handle({ type: 'contract-armed', actor: 'human' })
    loop.handle({ type: 'risky-tool-before', tool: 'write' })
    loop.handle({ type: 'model-claim', actor: 'model', claim: { id: 'c', text: 'x', class: 'hard', assertiveness: 'claim', predictedGateId: 'typecheck', predictedOutcome: true } })
    loop.handle({ type: 'tool-result', tool: 'write' })
    loop.handle({ type: 'gate-result', gateId: 'typecheck', result: { ok: false } })
    const stale = [
      { id: 'h1', text: 'A', excludes: ['c'], predictedObservable: 'a', experimentCommand: 'exp-a' },
      { id: 'h2', text: 'B', excludes: ['c'], predictedObservable: 'b', experimentCommand: 'exp-b' },
    ]
    loop.handle({ type: 'model-hypotheses', actor: 'model', hypotheses: stale })
    loop.handle({ type: 'experiment-result', experimentCommand: 'exp-a', result: { ok: false } })
    loop.handle({ type: 'model-hypotheses', actor: 'model', hypotheses: stale })
    loop.handle({ type: 'model-hypotheses', actor: 'model', hypotheses: stale })
    expect(loop.currentState).toBe('frontier-exhausted')
  })
})
