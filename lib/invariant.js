//#region src/invariant.ts
const PACKAGE_NAME = "@deepseek-ai/dsh-popper";
/** Cordis companion plugin name. */
const name = "popper-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: the loop table is private to per-session controller
* instances and exposes no package-owned event or snapshot that an independent
* companion can observe. Ledger integrity is proven by unit tests (hash chain).
*/
const install = () => {};
/**
* Register this package's invariant companion.
* @param ctx - cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
