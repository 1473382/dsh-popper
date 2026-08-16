import type { LedgerEntry } from './types.ts';
/** append-only 证伪账本：seq 单调、prevHash 成链、无删改。 */
export declare class Ledger {
    readonly sessionId: string;
    private entries;
    private sealed;
    constructor(sessionId: string);
    append(partial: Omit<LedgerEntry, 'id' | 'seq' | 'prevHash' | 'sessionId' | 'ts'>): LedgerEntry;
    get all(): readonly LedgerEntry[];
    /** 冻结账本（会话收尾），之后 append 抛错。 */
    seal(): void;
    /** 校验整条哈希链；false = 账本被篡改。 */
    verifyChain(): boolean;
}
export declare function hashEntry(entry: LedgerEntry): string;
//# sourceMappingURL=ledger.d.ts.map