// 证伪前置 lint：纯函数,零依赖。结构校验假设能否判别;词法启发 gate 能否失败。
// 借鉴 unlazy gate-lint「拒绝不可能失败的 oracle」思路,适配 Popper 的退出码语义(只看 exit 0)。
import type { HypothesisSpec } from './types.ts'

export interface LintFinding {
  id: string
  severity: 'reject' | 'advisory'
  message: string
}

/**
 * 一组假设若不能在任意两者间产生不同可观测量,就无法判别——拒绝;空字段亦拒绝。
 * 完成准则:返回空 = 这组假设结构上可判别(每条有可观测量+实验,且可观测量两两不同)。
 */
export function lintHypotheses(h: HypothesisSpec[]): LintFinding[] {
  const out: LintFinding[] = []
  for (let i = 0; i < h.length; i++) {
    const x = h[i]
    if (!x.predictedObservable || !x.predictedObservable.trim()) {
      out.push({ id: 'H' + i + ':empty-observable', severity: 'reject', message: '假设缺 predictedObservable,无可观测量即无法判别' })
    }
    if (!x.experimentCommand || !x.experimentCommand.trim()) {
      out.push({ id: 'H' + i + ':empty-experiment', severity: 'reject', message: '假设缺 experimentCommand,无实验即无判别' })
    }
  }
  // 重复的 predictedObservable:两假设预测同一可观测,实验无法在它们间判别。
  const seen = new Map<string, number[]>()
  for (let i = 0; i < h.length; i++) {
    const o = (h[i].predictedObservable ?? '').trim()
    if (!o) continue
    const arr = seen.get(o) ?? []
    arr.push(i)
    seen.set(o, arr)
  }
  seen.forEach((idxs, observable) => {
    if (idxs.length > 1) {
      out.push({ id: 'dup-observable:' + idxs.map(i => 'H' + i).join(','), severity: 'reject', message: '假设 ' + idxs.map(i => 'H' + i).join(' 与 ') + ' 的 predictedObservable 相同,无法在它们间判别' })
    }
  })
  return out
}

/**
 * 词法启发:命令看起来恒退出 0(不能失败)即建议。advisory,不阻断——避免误杀合法 gate。
 * 不接沙盒、不 shell-parse;只给契约编写者一个该复查的信号。完成准则:advisory 即提示,reject 仅空命令。
 */
export function lintGateCommand(command: string): LintFinding[] {
  const out: LintFinding[] = []
  const c = command.trim()
  if (!c) {
    out.push({ id: 'empty-command', severity: 'reject', message: 'gate 命令为空,不可能失败' })
    return out
  }
  if (/^(true|:)\s*$/.test(c)) {
    out.push({ id: 'constant-pass', severity: 'advisory', message: '命令恒退出 0(true/:),无法被证伪' })
  }
  if (/^echo\b/.test(c)) {
    out.push({ id: 'echo-only', severity: 'advisory', message: 'echo 仅打印,恒退出 0,无法被证伪' })
  }
  if (/node\s+-e\s*["'].*console\.log.*["']\s*$/.test(c) && !/process\.exit/.test(c)) {
    out.push({ id: 'node-log-only', severity: 'advisory', message: 'node -e 仅 console.log,无断言,恒退出 0,无法被证伪' })
  }
  if (/\|\|\s*true\s*$|&&\s*true\s*$/.test(c)) {
    out.push({ id: 'swallow-failure', severity: 'advisory', message: '尾部 || true / && true 吞掉非零退出,gate 无法失败' })
  }
  return out
}
