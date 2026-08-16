/**
 * plan-mode 契约武装折叠：纯函数，重放安全（从会话日志推导，无活镜像）。
 * plan-mode 存在时，契约在 force = plan/mode active；不存在时 strict 配置即契约。
 */
export type SessionLikeEvent = {
    type: string;
    data?: {
        active?: boolean;
    };
};
/** 折叠最后一条 plan/mode 事件；无则视为未激活。 */
export declare function foldPlanActive(events: readonly SessionLikeEvent[]): boolean;
/** strict 且（无 plan-mode 或 plan 激活）→ 武装。 */
export declare function armScope(mode: 'observe' | 'strict', planComposed: boolean, planActive: boolean): boolean;
//# sourceMappingURL=plan-arming.d.ts.map