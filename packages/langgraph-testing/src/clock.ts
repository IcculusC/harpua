import type { Provider } from "@nestjs/common";
import { z } from "zod";

/**
 * A source of the current time. Inject one into any node/service that would
 * otherwise call `new Date()` so tests can pin "now" to a fixed instant.
 */
export interface Clock {
  now(): Date;
}

/** DI token for the ambient {@link Clock}. Inject with `@Inject(CLOCK)`. */
export const CLOCK = Symbol.for("@harpua/langgraph-testing:CLOCK");

/**
 * ISO-8601 instant. Accepts a full timestamp (`2026-07-04T12:00:00Z`, offsets
 * allowed) or a date-only string (`2026-07-04`, interpreted as UTC midnight).
 * Validated with zod so a malformed input fails fast at the call site.
 */
const InstantString = z.union([
  z.string().datetime({ offset: true }),
  z.string().datetime(),
  z.string().date(),
]);

/**
 * Builds a {@link Clock} frozen at `iso`. Every `now()` returns a fresh `Date`
 * for that same instant (so callers can't mutate the shared value).
 *
 * @example
 * ```ts
 * const clock = fixedClock("2026-07-04T00:00:00Z");
 * clock.now().toISOString(); // always "2026-07-04T00:00:00.000Z"
 * ```
 */
export function fixedClock(iso: string): Clock {
  const instant = InstantString.parse(iso);
  const millis = new Date(instant).getTime();
  return { now: () => new Date(millis) };
}

/**
 * Nest provider binding {@link CLOCK} to a {@link fixedClock}. Drop it into a
 * testing module's `providers` so every `@Inject(CLOCK)` sees the same instant.
 *
 * @example
 * ```ts
 * const harness = await createGraphTestingModule({
 *   graphs: [StampGraph],
 *   providers: [StampNode, provideFixedClock("2026-07-04T00:00:00Z")],
 * });
 * ```
 */
export function provideFixedClock(iso: string): Provider {
  return { provide: CLOCK, useValue: fixedClock(iso) };
}
