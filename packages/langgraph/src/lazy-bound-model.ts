import type { GraphBoundModel } from "./graph-tools";

/** Keys that must never trigger resolution: promise/thenable detection and
 *  runtime inspection. Returning `undefined` for these keeps the proxy from
 *  being mistaken for a thenable (which would make `await proxy` hang) and
 *  keeps loggers/DI inspection from resolving the model at bootstrap. */
const PASSTHROUGH_KEYS: ReadonlySet<PropertyKey> = new Set([
  "then",
  "catch",
  "finally",
  "toJSON",
  "constructor",
  "$$typeof",
]);

/**
 * Wrap a not-yet-resolvable `GraphBoundModel` behind a proxy that defers
 * `resolve()` until the first METHOD CALL, then memoizes the result. Reading a
 * property returns a call-wrapper but does not resolve; only invoking it does.
 * `resolve` throwing propagates and is not memoized, so a genuinely missing arm
 * throws loudly on every call instead of hanging silently.
 */
export function lazyBoundProxy(resolve: () => GraphBoundModel): GraphBoundModel {
  let resolved: GraphBoundModel | undefined;
  const target = {} as GraphBoundModel;
  return new Proxy(target, {
    get(_t, prop): unknown {
      if (typeof prop === "symbol" || PASSTHROUGH_KEYS.has(prop)) {
        return undefined;
      }
      return (...args: unknown[]): unknown => {
        if (resolved === undefined) {
          try {
            resolved = resolve(); // throws propagate; success memoized below
          } catch (error) {
            // Convert sync throw to rejected promise for rejects.toThrow()
            return Promise.reject(error);
          }
        }
        const member = (resolved as unknown as Record<PropertyKey, unknown>)[prop];
        if (typeof member !== "function") {
          throw new Error(
            `lazyModel: the resolved model has no method '${String(prop)}'.`,
          );
        }
        return (member as (...a: unknown[]) => unknown).apply(resolved, args);
      };
    },
  });
}
