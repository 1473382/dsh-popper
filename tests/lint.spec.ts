import { describe, expect, it } from 'vitest'
import { lintHypotheses, lintGateCommand } from '../src/lint.ts'
import type { HypothesisSpec } from '../src/types.ts'

describe('lintHypotheses', () => {
  it('可判别假设（可观测量两两不同）→ 无 finding', () => {
    const hs: HypothesisSpec[] = [
      { id: 'h0', text: 'A', excludes: ['claim'], predictedObservable: 'exit 0', experimentCommand: 'cmdA' },
      { id: 'h1', text: 'B', excludes: ['claim'], predictedObservable: 'exit 1', experimentCommand: 'cmdB' },
    ]
    expect(lintHypotheses(hs)).toHaveLength(0)
  })

  it('重复 predictedObservable → reject', () => {
    const hs: HypothesisSpec[] = [
      { id: 'h0', text: 'A', excludes: ['claim'], predictedObservable: 'same', experimentCommand: 'cmdA' },
      { id: 'h1', text: 'B', excludes: ['claim'], predictedObservable: 'same', experimentCommand: 'cmdB' },
    ]
    const r = lintHypotheses(hs)
    expect(r.some(f => f.id.startsWith('dup-observable'))).toBe(true)
    expect(r.every(f => f.severity === 'reject')).toBe(true)
  })

  it('空 predictedObservable → reject', () => {
    const hs: HypothesisSpec[] = [
      { id: 'h0', text: 'A', excludes: ['claim'], predictedObservable: '', experimentCommand: 'cmdA' },
    ]
    expect(lintHypotheses(hs).some(f => f.id.endsWith(':empty-observable'))).toBe(true)
  })

  it('空 experimentCommand → reject', () => {
    const hs: HypothesisSpec[] = [
      { id: 'h0', text: 'A', excludes: ['claim'], predictedObservable: 'x', experimentCommand: '   ' },
    ]
    expect(lintHypotheses(hs).some(f => f.id.endsWith(':empty-experiment'))).toBe(true)
  })
})

describe('lintGateCommand', () => {
  it('true / : → advisory constant-pass', () => {
    expect(lintGateCommand('true').some(f => f.id === 'constant-pass')).toBe(true)
    expect(lintGateCommand(':').some(f => f.id === 'constant-pass')).toBe(true)
  })

  it('仅 echo → advisory echo-only', () => {
    expect(lintGateCommand('echo ok').some(f => f.id === 'echo-only')).toBe(true)
  })

  it('node -e 仅 console.log（无 process.exit）→ 命中', () => {
    expect(lintGateCommand('node -e "console.log(1)"').some(f => f.id === 'node-log-only')).toBe(true)
  })

  it('真 gate → 干净', () => {
    expect(lintGateCommand('pnpm run typecheck')).toHaveLength(0)
  })

  it('|| true / && true → swallow-failure', () => {
    expect(lintGateCommand('realcmd || true').some(f => f.id === 'swallow-failure')).toBe(true)
    expect(lintGateCommand('realcmd && true').some(f => f.id === 'swallow-failure')).toBe(true)
  })

  it('空命令 → reject empty-command', () => {
    const r = lintGateCommand('   ')
    expect(r.some(f => f.id === 'empty-command')).toBe(true)
    expect(r.every(f => f.severity === 'reject')).toBe(true)
  })

  it('node -e 带 process.exit 断言 → 不误报', () => {
    expect(lintGateCommand('node -e "if(x)process.exit(1);else console.log(1)"').some(f => f.id === 'node-log-only')).toBe(false)
  })
})
