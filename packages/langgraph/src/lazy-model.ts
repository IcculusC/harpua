import type { InjectionToken } from "@nestjs/common";

/**
 * A deferred model binding. `@LangGraphAgent({ model })` and
 * `provideGraphBoundModel` accept this in place of a bare token when the arm it
 * names (e.g. a `ChatModel:fast` registered by a later module) is not yet in the
 * container at feature-init time. The token is resolved on the graph's first
 * model call instead of at DI instantiation, so registration order stops being
 * an invisible coupling. See `provideGraphBoundModel`.
 */
export class LazyModel {
  constructor(readonly token: InjectionToken) {}
}

/** Wrap a model token so it binds on first use rather than at feature-init. */
export function lazyModel(token: InjectionToken): LazyModel {
  return new LazyModel(token);
}

/** Branded-class discriminator — true only for a `lazyModel(...)` result. */
export function isLazyModel(value: unknown): value is LazyModel {
  return value instanceof LazyModel;
}
