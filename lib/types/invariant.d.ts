/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-popper`.
 * @module @deepseek-ai/dsh-popper/invariant
 */
import type { Context } from '@deepseek-ai/cordis';
/** Cordis companion plugin name. */
export declare const name = "popper-invariant";
/** Service required before the companion can reserve package ownership. */
export declare const inject: string[];
/**
 * Register this package's invariant companion.
 * @param ctx - cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export declare const apply: (ctx: Context) => Promise<() => void>;
//# sourceMappingURL=invariant.d.ts.map