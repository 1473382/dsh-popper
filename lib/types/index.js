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
import z from '@deepseek-ai/schemastery';
import { Ledger } from "./ledger.js";
import { FalsificationLoop } from "./state-machine.js";
import { falsificationTool } from "./tool.js";
import { installWiring } from "./wiring.js";
export { FalsificationLoop, isValidClaim, makeClaimId } from "./state-machine.js";
export { Ledger } from "./ledger.js";
export const name = 'popper';
export const inject = ['tools'];
export const Config = z.object({
    mode: z.union(['observe', 'strict']).default('observe'),
    backstopRounds: z.number().min(1).default(6),
    noveltyRejectLimit: z.number().min(1).default(3),
    riskyTools: z.array(z.string()).default(['write', 'exec', 'patch', 'delete']),
    gateRegistry: z.array(z.object({ id: z.string().required(), command: z.string().required(), timeoutMs: z.number().min(1) })).default([]),
    falsificationToolName: z.string().default('falsification'),
    gateTimeoutMs: z.number().min(1).default(120000),
    outputCapChars: z.number().min(100).default(2000),
});
/** Convert validated plugin config to the controller's LoopConfig. */
export function toLoopConfig(config) {
    return {
        mode: config.mode,
        backstopRounds: config.backstopRounds,
        noveltyRejectLimit: config.noveltyRejectLimit,
        riskyTools: config.riskyTools,
        gateRegistry: new Map(config.gateRegistry.map(g => [g.id, { command: g.command }])),
    };
}
/**
 * Create a controller with its ledger. Sessions own one controller; wiring
 * plugins call this per session and drive it with LoopInput events.
 * @param sessionId - session identifier stamped on every ledger entry.
 * @param config - validated plugin config.
 * @returns the ledger and loop controller pair.
 */
export function createFalsificationLoop(sessionId, config) {
    const ledger = new Ledger(sessionId);
    return { ledger, loop: new FalsificationLoop(toLoopConfig(config), ledger) };
}
/**
 * Install the plugin. Validates configuration fail-loud: a strict deployment
 * must name at least one gate and one risky tool, or the load fails.
 * @param ctx - cordis context.
 * @param config - validated {@link Config}.
 */
export function apply(ctx, config) {
    const loopConfig = toLoopConfig(config);
    if (loopConfig.mode === 'strict' && loopConfig.gateRegistry.size === 0) {
        throw new Error('popper: strict mode requires a non-empty gateRegistry (commands must come from the task contract, not the model)');
    }
    if (!Number.isInteger(loopConfig.backstopRounds) || !Number.isInteger(loopConfig.noveltyRejectLimit)) {
        throw new Error('popper: backstopRounds and noveltyRejectLimit must be integers');
    }
    if (loopConfig.mode === 'strict' && loopConfig.riskyTools.length === 0) {
        throw new Error('popper: strict mode requires a non-empty riskyTools list');
    }
    const toolName = config.falsificationToolName ?? 'falsification';
    const gateTimeoutMs = config.gateTimeoutMs ?? 120000;
    const outputCapChars = config.outputCapChars ?? 2000;
    const gateMap = new Map(config.gateRegistry.map(g => g.timeoutMs === undefined
        ? [g.id, { command: g.command }]
        : [g.id, { command: g.command, timeoutMs: g.timeoutMs }]));
    ctx.tools.register(falsificationTool(toolName));
    installWiring(ctx, {
        mode: loopConfig.mode,
        riskyTools: loopConfig.riskyTools,
        falsificationToolName: toolName,
        gateRegistry: gateMap,
        backstopRounds: loopConfig.backstopRounds,
        noveltyRejectLimit: loopConfig.noveltyRejectLimit,
        gateTimeoutMs,
        outputCapChars,
    });
}
//# sourceMappingURL=index.js.map