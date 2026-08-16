import { describe, expect, it } from 'vitest'
import { armScope, foldPlanActive } from '../src/plan-arming.ts'

describe('plan arming fold', () => {
  it('无 plan/mode 事件 -> 未激活', () => {
    expect(foldPlanActive([])).toBe(false)
    expect(foldPlanActive([{ type: 'user/message', data: {} }])).toBe(false)
  })
  it('最后一条 wins：false -> true -> false', () => {
    expect(foldPlanActive([{ type: 'plan/mode', data: { active: true } }, { type: 'plan/mode', data: { active: false } }])).toBe(false)
    expect(foldPlanActive([{ type: 'plan/mode', data: { active: false } }, { type: 'plan/mode', data: { active: true } }])).toBe(true)
  })
  it('armScope：无 plan-mode 时 strict 即武装；有 plan-mode 时跟随 active', () => {
    expect(armScope('strict', false, false)).toBe(true)
    expect(armScope('observe', false, false)).toBe(false)
    expect(armScope('strict', true, true)).toBe(true)
    expect(armScope('strict', true, false)).toBe(false)
  })
})
