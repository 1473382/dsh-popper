//#region src/invariant.ts
const PACKAGE_NAME = "@deepseek-ai/dsh-popper";
/** Cordis companion plugin name. */
const name = "popper-invariant";
/**
* The `invariants` service is optional. Older DeepSeek Harness runtimes (for
* example the rc.8 bundle tree that some hosts ship) do not mount the
* `invariants` service. Declaring it here would leave the companion permanently
* `pending (waiting for service: invariants)` and block the whole profile from
* loading. We therefore do not require it and degrade to a no-op when absent.
*/
const inject = [];
/**
* No runtime invariant: the loop table is private to per-session controller
* instances and exposes no package-owned event or snapshot that an independent
* companion can observe. Ledger integrity is proven by unit tests (hash chain).
*/
const install = () => {};
/**
* Register this package's invariant companion when the `invariants` service is
* mounted, and no-op otherwise so the plugin loads on every runtime.
* @param ctx - cordis context.
* @returns the installed registration's disposer, or `undefined` when the
*          `invariants` service is unavailable.
*/
const apply = (ctx) => {
  const invariants = ctx.get("invariants", false);
  return invariants ? Promise.resolve(invariants.register(PACKAGE_NAME, install)) : undefined;
};
//#endregion
export { apply, inject, name };
