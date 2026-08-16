import type { Context, Disposable } from '@deepseek-ai/cordis';
import type { GateResult } from './types.ts';
export interface WiringConfig {
    mode: 'observe' | 'strict';
    riskyTools: string[];
    falsificationToolName: string;
    gateRegistry: ReadonlyMap<string, {
        command: string;
        timeoutMs?: number;
    }>;
    backstopRounds: number;
    noveltyRejectLimit: number;
    gateTimeoutMs: number;
    outputCapChars: number;
}
/** 执行确定性 gate 命令：超时、输出截断（head+tail+hash），不接沙盒（见 README Known Limitations）。 */
export declare function runGate(command: string, timeoutMs: number, cap: number): Promise<GateResult>;
/**
 * 接线安装器：注册监听并把工具侧效应转成 LoopInput。
 * @param ctx - cordis context.
 * @param config - wiring 配置。
 * @returns disposer（registrations are effects）。
 */
export declare function installWiring(ctx: Context, config: WiringConfig): Disposable;
//# sourceMappingURL=wiring.d.ts.map