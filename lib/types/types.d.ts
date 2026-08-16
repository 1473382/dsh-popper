export type ClaimClass = 'hard' | 'empirical' | 'semantic' | 'judgment';
export type Assertiveness = 'claim' | 'strong' | 'hedged';
export type Verdict = 'passed' | 'falsified' | 'unknown';
export type Actor = 'model' | 'plugin' | 'human' | 'subagent';
export type LedgerKind = 'contract' | 'protocol' | 'claim' | 'gate' | 'falsification' | 'hypotheses' | 'experiment' | 'frontier' | 'escalation' | 'resume' | 'disarm';
export interface ClaimSpec {
    id: string;
    text: string;
    class: ClaimClass;
    assertiveness: Assertiveness;
    predictedGateId: string;
    predictedOutcome: boolean;
}
export interface GateSpec {
    id: string;
    command: string;
    sandbox?: string;
    timeoutMs?: number;
}
export interface GateResult {
    ok: boolean;
    exitCode?: number;
    evidenceHash?: string;
    outputHead?: string;
    outputTail?: string;
    truncated?: boolean;
}
export interface HypothesisSpec {
    id: string;
    text: string;
    /** 与哪些已证伪假设互斥 */
    excludes: string[];
    predictedObservable: string;
    /** 判别实验命令；禁止复用已被证伪的实验 */
    experimentCommand: string;
}
export interface LedgerEntry {
    id: string;
    seq: number;
    prevHash: string;
    sessionId: string;
    ts: string;
    actor: Actor;
    kind: LedgerKind;
    message?: string;
    claim?: ClaimSpec;
    gate?: GateSpec;
    result?: GateResult;
    hypotheses?: HypothesisSpec[];
    selected?: string;
    verdict?: Verdict;
    contextRef?: string;
}
//# sourceMappingURL=types.d.ts.map