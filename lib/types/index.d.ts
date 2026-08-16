/**
 * Falsification-driven correction loop for agent sessions. Claim commitment,
 * gate falsification, and hypothesis revision turn a failed hard check into a
 * falsification event that forces mutually exclusive new hypotheses carrying
 * discriminating experiments — never a blind retry. Deterministic judging
 * (the state machine and ledger) is code; hypothesis generation stays with the
 * model, constrained to the corridor of falsified evidence.
 *
 * The controller (state machine + ledger) is agent-agnostic: any host can drive
 * it with the LoopInput events. Session-event wiring (arming from an approved
 * task contract, tool intercepts, gate execution) is deferred work — see README
 * Known Limitations. Until then `apply` validates configuration fail-loud and
 * ships the controller factory for wiring plugins.
 * @module @deepseek-ai/dsh-popper
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { Ledger } from './ledger.ts';
import { FalsificationLoop } from './state-machine.ts';
import type { LoopConfig } from './state-machine.ts';
export { FALSIFICATION_LEDGER_EVENT } from './types-events.ts';
export { FalsificationLoop, isValidClaim, makeClaimId } from './state-machine.ts';
export { Ledger } from './ledger.ts';
export type { LoopConfig, LoopInput, LoopState } from './state-machine.ts';
export type { Actor, Assertiveness, ClaimClass, ClaimSpec, GateResult, GateSpec, HypothesisSpec, LedgerEntry, LedgerKind, Verdict, } from './types.ts';
export declare const name = "popper";
export declare const inject: string[];
/**
 * Plugin configuration. `mode` defaults to observe (record-only, zero gating);
 * strict mode is armed by an approved task contract in the wiring layer. A
 * strict deployment with an empty `gateRegistry` or `riskyTools` fails loud at
 * load — the contract table is meaningless without at least one gate.
 */
export interface Config {
    /** observe records evidence without gating; strict enforces the loop (default 'observe'). */
    mode?: 'observe' | 'strict';
    /** Cost safety valve: consecutive protocol violations that force human escalation (default 6). */
    backstopRounds?: number;
    /** Consecutive novelty rejections that declare the hypothesis frontier exhausted (default 3). */
    noveltyRejectLimit?: number;
    /** Tool names that trigger claim commitment (default ['write','exec','patch','delete']). */
    riskyTools?: string[];
    /** Deterministic gate commands; commands come from the task contract, never the model (default []). */
    gateRegistry?: {
        id: string;
        command: string;
        timeoutMs?: number;
    }[];
    /** Model-facing tool name for the falsification protocol (default 'falsification'). */
    falsificationToolName?: string;
    /** Gate execution timeout in ms (default 120000). */
    gateTimeoutMs?: number;
    /** Gate output injection cap in chars (default 2000). */
    outputCapChars?: number;
}
export declare const Config: z<Config>;
/** Convert validated plugin config to the controller's LoopConfig. */
export declare function toLoopConfig(config: Config): LoopConfig;
/**
 * Create a controller with its ledger. Sessions own one controller; wiring
 * plugins call this per session and drive it with LoopInput events.
 * @param sessionId - session identifier stamped on every ledger entry.
 * @param config - validated plugin config.
 * @returns the ledger and loop controller pair.
 */
export declare function createFalsificationLoop(sessionId: string, config: Config): {
    loop: FalsificationLoop;
    ledger: Ledger;
};
/**
 * Install the plugin. Validates configuration fail-loud: a strict deployment
 * must name at least one gate and one risky tool, or the load fails.
 * @param ctx - cordis context.
 * @param config - validated {@link Config}.
 */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map