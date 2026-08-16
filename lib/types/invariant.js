/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-popper`.
 * @module @deepseek-ai/dsh-popper/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-popper';
/** Cordis companion plugin name. */
export const name = 'popper-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: the loop table is private to per-session controller
 * instances and exposes no package-owned event or snapshot that an independent
 * companion can observe. Ledger integrity is proven by unit tests (hash chain).
 */
const install = () => { };
/**
 * Register this package's invariant companion.
 * @param ctx - cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
/* jscpd:ignore-end */
//# sourceMappingURL=invariant.js.map