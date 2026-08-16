/** 折叠最后一条 plan/mode 事件；无则视为未激活。 */
export function foldPlanActive(events) {
    let active = false;
    for (const e of events) {
        if (e.type === 'plan/mode' && e.data && typeof e.data.active === 'boolean')
            active = e.data.active;
    }
    return active;
}
/** strict 且（无 plan-mode 或 plan 激活）→ 武装。 */
export function armScope(mode, planComposed, planActive) {
    return mode === 'strict' && (!planComposed || planActive);
}
//# sourceMappingURL=plan-arming.js.map