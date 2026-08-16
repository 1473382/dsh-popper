import { describe, expect, it } from 'vitest'
import { Ledger, hashEntry } from '../src/ledger.ts'

describe('ledger', () => {
  it('append-only：seal 后 append 抛错', () => {
    const l = new Ledger('s')
    l.seal()
    expect(() => l.append({ actor: 'plugin', kind: 'claim' })).toThrow(/append-only/)
  })

  it('哈希链：追加条目后 verifyChain 仍为 true', () => {
    const l = new Ledger('s')
    l.append({ actor: 'plugin', kind: 'contract' })
    const e2 = l.append({ actor: 'model', kind: 'claim' })
    expect(l.verifyChain()).toBe(true)
    expect(e2.seq).toBe(2)
    expect(e2.prevHash).toBe(hashEntry(l.all[0]!))
  })

  it('篡改检测：改历史条目后 verifyChain 为 false', () => {
    const l = new Ledger('s')
    l.append({ actor: 'plugin', kind: 'contract' })
    l.append({ actor: 'model', kind: 'claim' })
    const first = l.all[0]!
    first.message = 'tampered'
    expect(l.verifyChain()).toBe(false)
  })
})
