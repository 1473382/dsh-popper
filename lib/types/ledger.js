import { createHash, randomUUID } from 'node:crypto';
/** append-only 证伪账本：seq 单调、prevHash 成链、无删改。 */
export class Ledger {
    sessionId;
    entries = [];
    sealed = false;
    constructor(sessionId) {
        this.sessionId = sessionId;
    }
    append(partial) {
        if (this.sealed)
            throw new Error('ledger sealed: append-only violated');
        const prev = this.entries.at(-1);
        const entry = {
            ...partial,
            id: randomUUID(),
            seq: prev ? prev.seq + 1 : 1,
            prevHash: prev ? hashEntry(prev) : '',
            sessionId: this.sessionId,
            ts: new Date().toISOString(),
        };
        this.entries.push(entry);
        return entry;
    }
    get all() {
        return this.entries;
    }
    /** 冻结账本（会话收尾），之后 append 抛错。 */
    seal() {
        this.sealed = true;
    }
    /** 校验整条哈希链；false = 账本被篡改。 */
    verifyChain() {
        let prevHash = '';
        for (const e of this.entries) {
            if (e.prevHash !== prevHash)
                return false;
            prevHash = hashEntry(e);
        }
        return true;
    }
}
export function hashEntry(entry) {
    return createHash('sha256').update(JSON.stringify(entry)).digest('hex');
}
//# sourceMappingURL=ledger.js.map