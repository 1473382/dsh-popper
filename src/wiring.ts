// agent-loop 接线：每 agent 一个控制器；工具后置瀑布（非否决，RTR 模式）驱动循环。
// 契约武装：plan-mode 存在时跟随 plan/mode 折叠（log 重放安全）；否则 strict 配置即契约。
// 前沿耗尽/backstop：userQuestions 在场则向人工提问（resume/disarm），缺席则记录 escalation 需求并锁存（不重问）。
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import type { Context, Disposable } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource, UserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PostToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { Session } from '@deepseek-ai/dsh-session'
import { FalsificationLoop, makeClaimId } from './state-machine.ts'
import type { LoopConfig, LoopInput, LoopState } from './state-machine.ts'
import { Ledger } from './ledger.ts'
import { FALSIFICATION_LEDGER_EVENT } from './types-events.ts'
import { armScope, foldPlanActive } from './plan-arming.ts'
import type { SessionLikeEvent } from './plan-arming.ts'
import type { FalsificationCallArgs } from './tool.ts'
import type { GateResult, LedgerEntry } from './types.ts'

export interface WiringConfig {
  mode: 'observe' | 'strict'
  riskyTools: string[]
  falsificationToolName: string
  gateRegistry: ReadonlyMap<string, { command: string; timeoutMs?: number }>
  backstopRounds: number
  noveltyRejectLimit: number
  gateTimeoutMs: number
  outputCapChars: number
}

interface SessionLoop {
  loop: FalsificationLoop
  ledger: Ledger
  session: Session
  /** 锁存：已向人工请求升级（避免在无人应答时每工具调用重问一次）。 */
  escalationPending: boolean
}

/** userQuestions 审批面（可选服务，动态探测，无编译依赖）。 */
interface UserQuestionLike {
  ask(req: {
    questions: { id: string; question: string; options?: { label: string; description?: string }[] }[]
    agent?: unknown
  }): Promise<{ answers: { id: string; selected: string[] }[] }>
}

const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'popper' }

function notice(text: string, summary: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { ...PLUGIN_SOURCE, form: 'notice', summary } })
}

const claimDemand = (tool: string) =>
  `You performed the risky ${tool} call without committing a claim. Next risky change must start with falsification action claim: root-cause hypothesis + predicted gate outcome (gate id from the task contract).`
const falsifiedNotice = (claimId: string, gateId: string) =>
  `Claim ${claimId} was falsified by gate ${gateId}. Your next action must be falsification action hypotheses: >=2 mutually exclusive new hypotheses, each with predictedObservable and experimentCommand. Repair is only allowed as a corollary of a chosen hypothesis.`
const experimentViolation = (command: string, allowed: string[]) =>
  `Experiment ${command} is not among your selected hypotheses. Pick one of: ${allowed.join(' | ')}.`
const pendingNotice =
  'A falsification step is pending: commit the demanded claim or hypotheses before further risky changes.'
const armedBanner = (gates: string[]) =>
  `Popper armed (strict). Gates: ${gates.join(', ') || '(none — add gateRegistry)'}. Risky calls must be backed by a committed falsification claim first.`
const observeBanner =
  'Popper observing: recording evidence only, no gating. Set mode: strict plus gateRegistry to arm the loop.'
const disarmedBanner =
  'Popper disarmed: the contract was revoked, no gating. Re-arm by feeding a fresh contract-armed event.'
const escalationQuestion =
  '证伪循环已达假设前沿耗尽：继续契约（会重置前沿预算）还是撤销契约？若无应答 UI，agent 不得继续高风险变更，直到人工 resume/disarm。'

/** 执行确定性 gate 命令：超时、输出截断（head+tail+hash），不接沙盒（见 README Known Limitations）。 */
export function runGate(command: string, timeoutMs: number, cap: number): Promise<GateResult> {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let buf = ''
    const onData = (chunk: Buffer) => {
      buf = (buf + chunk.toString()).slice(-(cap * 2 + 1))
    }
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, evidenceHash: hashOf(buf), outputHead: 'gate timeout', outputTail: '', truncated: false }) }, timeoutMs)
    const finish = (code: number | null, note?: string) => {
      clearTimeout(timer)
      const truncated = buf.length > cap
      const result: GateResult = {
        ok: code === 0,
        evidenceHash: hashOf(buf),
        outputHead: note !== undefined ? note : buf.slice(0, cap),
        outputTail: buf.slice(-cap),
        truncated,
      }
      if (code !== null && note === undefined) result.exitCode = code
      resolve(result)
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', err => finish(null, 'gate failed to start: ' + String(err.message ?? err)))
    child.on('close', code => finish(code))
  })
}

function hashOf(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

/**
 * Append one ledger entry to the session log; a disabled durable record is a
 * swallowed logging failure (the in-memory ledger still carries the entry).
 */
function durableAppend(session: Session, entry: LedgerEntry): boolean {
  // ignorable: 账本是纯信息性记录——不认识 falsification/ledger 的旧 host 读取时
  // 安全跳过该事件而非拒绝整份日志（SessionFormatUnsupportedError）。
  // 见 README Known Limitations 事件兼容一节与 coordinator assertEventsSupported。
  const appendRecord = session.append.bind(session) as (event: typeof FALSIFICATION_LEDGER_EVENT, value: LedgerEntry, opts: { ignorable?: true }) => void
  try {
    appendRecord(FALSIFICATION_LEDGER_EVENT, entry, { ignorable: true })
    return true
  } catch {
    return false
  }
}

function planActiveNow(session: Session): boolean {
  return foldPlanActive([...session.events] as unknown as SessionLikeEvent[])
}

/**
 * 接线安装器：注册监听并把工具侧效应转成 LoopInput。
 * @param ctx - cordis context.
 * @param config - wiring 配置。
 * @returns disposer（registrations are effects）。
 */
export function installWiring(ctx: Context, config: WiringConfig): Disposable {
  const controllers = new WeakMap<Agent, SessionLoop>()
  /** 每会话只播报一次模式状态（首个工具调用时），避免会话级噪音。 */
  const announced = new Set<string>()

  /** 探测 plan-mode 是否已组合（ctx.get 读全局服务存储，可选服务豁免编译依赖）。 */
  function planComposed(): boolean {
    return (ctx as unknown as { get(name: string): unknown }).get('planMode') !== undefined
  }

  function controller(agent: Agent): SessionLoop {
    let c = controllers.get(agent)
    if (!c) {
      const ledger = new Ledger(agent.session.id)
      const loopConfig: LoopConfig = {
        mode: config.mode,
        backstopRounds: config.backstopRounds,
        noveltyRejectLimit: config.noveltyRejectLimit,
        riskyTools: config.riskyTools,
        gateRegistry: new Map([...config.gateRegistry].map(([id, g]) => [id, { command: g.command }])),
      }
      c = { loop: new FalsificationLoop(loopConfig, ledger), ledger, session: agent.session, escalationPending: false }
      // 武装判定：plan-mode 已组合则折叠 plan/mode；否则 strict 配置即契约（首建即武装）。
      if (armScope(config.mode, planComposed(), planActiveNow(agent.session))) {
        for (const entry of c.loop.handle({ type: 'contract-armed', actor: 'human' })) durableAppend(c.session, entry)
      }
      controllers.set(agent, c)
    }
    return c
  }

  function record(c: SessionLoop, partial: Omit<LedgerEntry, 'id' | 'seq' | 'prevHash' | 'sessionId' | 'ts'>): LedgerEntry {
    const entry = c.ledger.append(partial)
    durableAppend(c.session, entry)
    return entry
  }

  function feed(c: SessionLoop, input: LoopInput): LedgerEntry[] {
    const entries = c.loop.handle(input)
    for (const entry of entries) durableAppend(c.session, entry)
    return entries
  }

  function lastClaim(c: SessionLoop) {
    for (const e of [...c.ledger.all].reverse()) if (e.kind === 'claim' && e.claim) return e.claim
    return undefined
  }

  /** 前沿耗尽 → 请求人工裁决；无应答者/失败时记录 escalation 需求并锁存（只记录一次）。 */
  async function maybeEscalate(c: SessionLoop, agent: unknown): Promise<void> {
    if (c.loop.currentState !== 'frontier-exhausted' || c.escalationPending) return
    c.escalationPending = true
    const uq = (ctx as unknown as { get(name: string): unknown }).get('userQuestions') as UserQuestionLike | undefined
    if (!uq) {
      record(c, { actor: 'plugin', kind: 'protocol', verdict: 'unknown', message: 'escalation required: no answerer; manual resume/disarm needed' })
      return
    }
    try {
      const answer = await uq.ask({
        questions: [{
          id: 'fl-escalation',
          question: escalationQuestion,
          options: [{ label: 'Resume', description: '重置前沿预算，继续契约' }, { label: 'Disarm', description: '撤销契约，停止门控' }],
        }],
        agent,
      })
      const selected = answer.answers.find(a => a.id === 'fl-escalation')?.selected?.[0]
      feed(c, { type: 'human-escalation', decision: selected === 'Disarm' ? 'disarm' : 'resume' })
      c.escalationPending = false
    } catch (err) {
      record(c, { actor: 'plugin', kind: 'protocol', verdict: 'unknown', message: 'escalation required: ask failed (' + String((err as Error).message ?? err).slice(0, 120) + '); manual resume/disarm needed' })
    }
  }

  async function routeExecution(c: SessionLoop, exec: ToolExecution, inject: (msg: UserMessage) => void): Promise<LedgerEntry[]> {
    const name = exec.name
    const s: LoopState = c.loop.currentState
    // plan 关闭（plan-mode 已组合且 plan/mode=false）：契约暂停，门控挂起（observe 式）。
    if (config.mode === 'strict' && planComposed() && !planActiveNow(c.session)) return []
    // 每会话一次：播报当前模式与武装状态，让安装即可见（observe 也不静默）。
    if (!announced.has(c.session.id)) {
      announced.add(c.session.id)
      if (config.mode === 'strict') inject(notice(s === 'disarmed' ? disarmedBanner : armedBanner([...config.gateRegistry.keys()]), 'popper status'))
      else inject(notice(observeBanner, 'popper status'))
    }
    if (s === 'frontier-exhausted' || s === 'escalated') await maybeEscalate(c, exec.agent)
    if (name === config.falsificationToolName) {
      const args = exec.arguments as FalsificationCallArgs
      if (args.action === 'claim') {
        if (args.rootCause && args.predictedGateId && typeof args.predictedOutcome === 'boolean') {
          return feed(c, { type: 'model-claim', actor: 'model', claim: { id: makeClaimId(), text: args.rootCause, class: 'hard', assertiveness: 'claim', predictedGateId: args.predictedGateId, predictedOutcome: args.predictedOutcome } })
        }
        return []
      }
      if (args.action === 'hypotheses' && Array.isArray(args.hypotheses) && args.hypotheses.length > 0) {
        return feed(c, { type: 'model-hypotheses', actor: 'model', hypotheses: args.hypotheses.map((h, i) => ({ id: 'h' + i, text: h.text, excludes: ['claim'], predictedObservable: h.predictedObservable, experimentCommand: h.experimentCommand })) })
      }
      if (args.action === 'experiment' && args.experimentCommand) {
        if (s !== 'experiment-selected' || !c.loop.selectedExperiments.includes(args.experimentCommand)) {
          const allowed = [...c.loop.selectedExperiments]
          inject(notice(experimentViolation(args.experimentCommand, allowed), 'experiment rejected'))
          return [record(c, { actor: 'plugin', kind: 'protocol', verdict: 'unknown', message: 'experiment not in whitelist: ' + args.experimentCommand })]
        }
        return feed(c, { type: 'experiment-result', experimentCommand: args.experimentCommand, result: await runGate(args.experimentCommand, config.gateTimeoutMs, config.outputCapChars) })
      }
      return []
    }
    if (config.mode === 'observe' || s === 'disarmed') return []
    if (config.riskyTools.includes(name)) {
      if (s === 'armed') {
        inject(notice(claimDemand(name), 'claim missing'))
        return [record(c, { actor: 'plugin', kind: 'protocol', verdict: 'unknown', message: 'risky tool ran without claim: ' + name })]
      }
      if (s === 'claim-committed') {
        const entries = feed(c, { type: 'tool-result', tool: name })
        const afterTool = c.loop.currentState
        if (afterTool === 'gate-pending') {
          const claim = lastClaim(c)
          const gate = claim ? config.gateRegistry.get(claim.predictedGateId) : undefined
          if (gate && claim) {
            const result = await runGate(gate.command, config.gateTimeoutMs, config.outputCapChars)
            entries.push(...feed(c, { type: 'gate-result', gateId: claim.predictedGateId, result }))
            const stateAfter = c.loop.currentState
            if (stateAfter === 'falsified') {
              inject(notice(falsifiedNotice(claim.id, claim.predictedGateId), 'claim ' + claim.id + ' falsified'))
            }
          }
        }
        return entries
      }
      if (s === 'awaiting-claim' || s === 'falsified' || s === 'experiment-selected') {
        inject(notice(pendingNotice, 'falsification pending'))
        return [record(c, { actor: 'plugin', kind: 'protocol', verdict: 'unknown', message: 'risky tool during pending falsification step: ' + name })]
      }
    }
    return []
  }

  const disposer = ctx.on('tools/post-execute', async (exec, _result, next): Promise<PostToolDecision> => {
    const downstream = await next()
    if (!exec.agent) return downstream
    const c = controller(exec.agent)
    const contexts: UserMessage[] = []
    await routeExecution(c, exec, msg => contexts.push(msg))
    if (contexts.length === 0) return downstream
    if (downstream.kind === 'block') {
      return { kind: 'block', feedback: downstream.feedback, additionalContexts: [...contexts, ...downstream.additionalContexts ?? []] }
    }
    return { ...downstream, additionalContexts: [...contexts, ...downstream.additionalContexts ?? []] }
  })

  return () => { disposer() }
}