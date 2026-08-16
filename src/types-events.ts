// 会话级事件声明合并：'falsification/ledger' 与会话日志同源（model-visible <-> logged）。

import type { LedgerEntry } from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Appends one popper ledger entry to the session log. All
     * judging/recording is deterministic; entries are append-only with a hash chain.
     * @param data - one append-only ledger entry.
     */
    'falsification/ledger': LedgerEntry
  }
}

/** Durable session event type for one ledger entry. */
export const FALSIFICATION_LEDGER_EVENT = 'falsification/ledger' as const
