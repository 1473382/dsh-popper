import { Ledger } from './ledger.ts';
import type { Actor, GateResult, HypothesisSpec, LedgerEntry, ClaimSpec } from './types.ts';
export type LoopState = 'observe' | 'armed' | 'awaiting-claim' | 'claim-committed' | 'gate-pending' | 'falsified' | 'experiment-selected' | 'frontier-exhausted' | 'escalated' | 'disarmed';
export interface LoopConfig {
    mode: 'observe' | 'strict';
    /** 成本安全阀：协议不合格上限，超限转人工 */
    backstopRounds: number;
    /** 连续新颖性拒绝 → 前沿耗尽判定 */
    noveltyRejectLimit: number;
    riskyTools: readonly string[];
    /** gate 注册表：命令只来自契约，模型只能引用 gate id */
    gateRegistry: ReadonlyMap<string, {
        command: string;
    }>;
}
export type LoopInput = {
    type: 'contract-armed';
    actor: Actor;
} | {
    type: 'risky-tool-before';
    tool: string;
} | {
    type: 'model-claim';
    actor: Actor;
    claim: ClaimSpec;
} | {
    type: 'tool-result';
    tool: string;
} | {
    type: 'gate-result';
    gateId: string;
    result: GateResult;
} | {
    type: 'model-hypotheses';
    actor: Actor;
    hypotheses: HypothesisSpec[];
} | {
    type: 'experiment-result';
    experimentCommand: string;
    result: GateResult;
} | {
    type: 'human-escalation';
    decision: 'resume' | 'disarm';
} | {
    type: 'disarm';
} | {
    type: 'contract-revoked';
};
export declare class FalsificationLoop {
    readonly config: LoopConfig;
    private readonly ledger;
    private state;
    private protocolViolations;
    private noveltyRejects;
    private activeClaim;
    private lastExperimentCommands;
    private selected;
    constructor(config: LoopConfig, ledger: Ledger);
    get currentState(): LoopState;
    /** 当前被选的判别实验命令（白名单）；wiring 层只放行这些命令。 */
    get selectedExperiments(): readonly string[];
    /** 处理一个输入事件，返回本次追加的账本条目（调用方负责转成 session 事件发出）。 */
    handle(input: LoopInput): LedgerEntry[];
    private applyEscalation;
}
export declare function isValidClaim(c: ClaimSpec): boolean;
export declare function makeClaimId(): string;
//# sourceMappingURL=state-machine.d.ts.map