import { z } from "zod";

/**
 * The shape an interrupted `invoke` result carries: LangGraph surfaces the
 * pending interrupts under `__interrupt__` (a non-empty array of `{ value }`)
 * instead of finishing. Validated with zod rather than a hand-rolled guard.
 */
const InterruptedResult = z.object({
  __interrupt__: z
    .array(z.object({ value: z.unknown(), id: z.string().optional() }))
    .min(1),
});

/**
 * Typed assertion + extractor for a paused graph. Given the result of
 * `graph.invoke(...)` that hit an `interrupt()`, returns the first interrupt's
 * payload (the value passed to `interrupt(...)`), typed as `T`. Throws a helpful
 * error if the result did not actually interrupt — so a test that expected a
 * pause but got a completed run fails with a clear message instead of a vague
 * `undefined`.
 *
 * @example
 * ```ts
 * const paused = await hil.invoke({ question: "Name?", answer: "" }, cfg);
 * const question = expectInterrupt<string>(paused);
 * expect(question).toBe("Name?");
 * const done = await hil.resume(threadId, "Ada");
 * ```
 */
export function expectInterrupt<T = unknown>(result: unknown): T {
  const parsed = InterruptedResult.safeParse(result);
  if (!parsed.success) {
    const keys =
      result && typeof result === "object"
        ? Object.keys(result as object)
        : [];
    throw new Error(
      "expectInterrupt: expected an interrupted graph result carrying a " +
        "non-empty '__interrupt__' array, but none was found. Result keys: " +
        `[${keys.join(", ")}]. Did the graph pause at interrupt()? Ensure a ` +
        "checkpointer is configured and a thread_id was supplied.",
    );
  }
  const [first] = parsed.data.__interrupt__;
  return (first as { value: T }).value;
}
