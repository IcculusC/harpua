import type { StreamInterrupt } from "./interfaces";

/** The key under which LangGraph surfaces interrupts in stream chunks / state. */
export const INTERRUPT_KEY = "__interrupt__";

/**
 * Detects the interrupt terminator in a stream chunk. When a super-step calls
 * `interrupt()`, both `values` and `updates` mode emit one final chunk of the
 * shape `{ __interrupt__: StreamInterrupt[] }` and then the stream ends. This
 * returns that array (so a consumer can surface the payload and call `resume()`),
 * or `undefined` for an ordinary chunk.
 *
 * @example
 * ```ts
 * for await (const chunk of await graph.streamUpdates(input, cfg)) {
 *   const interrupts = getStreamedInterrupts(chunk);
 *   if (interrupts) { await graph.resume(threadId, answer); break; }
 *   // ...handle the normal node update
 * }
 * ```
 */
export function getStreamedInterrupts(
  chunk: unknown,
): readonly StreamInterrupt[] | undefined {
  if (chunk === null || typeof chunk !== "object") return undefined;
  const value = (chunk as Record<string, unknown>)[INTERRUPT_KEY];
  return Array.isArray(value)
    ? (value as readonly StreamInterrupt[])
    : undefined;
}
