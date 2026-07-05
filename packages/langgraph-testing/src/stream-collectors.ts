import { getStreamedInterrupts, type StreamInterrupt } from "@harpua/langgraph";

/**
 * Drains an async iterable into an array. The facade's `stream*` methods return
 * `Promise<AsyncIterable<T>>`, so the usual call is
 * `collectStream(await graph.streamUpdates(input, cfg))`.
 *
 * @example
 * ```ts
 * const chunks = await collectStream(await graph.stream({ steps: [], total: 0 }));
 * expect(chunks.map((c) => Object.keys(c)[0])).toEqual(["NodeA", "NodeB"]);
 * ```
 */
export async function collectStream<T>(
  iterable: AsyncIterable<T>,
): Promise<T[]> {
  const out: T[] = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

/** Result of {@link collectUntilInterrupt}. */
export interface CollectedUntilInterrupt<TChunk> {
  /** Every ordinary chunk seen before the interrupt terminator (excludes it). */
  chunks: TChunk[];
  /**
   * The interrupts carried by the terminator chunk, or `undefined` if the
   * stream ended without interrupting.
   */
  interrupts: readonly StreamInterrupt[] | undefined;
}

/**
 * Drains a stream up to (and stopping at) the interrupt terminator. When a
 * super-step calls `interrupt()`, both `values` and `updates` mode emit one
 * final `{ __interrupt__: StreamInterrupt[] }` chunk and then end — this splits
 * the ordinary chunks from that payload so a test can assert the node sequence
 * AND the pending interrupt, then `resume()`.
 *
 * @example
 * ```ts
 * const { chunks, interrupts } = await collectUntilInterrupt(
 *   await hil.streamUpdates({ question: "Name?", answer: "" }, cfg),
 * );
 * expect(interrupts?.[0].value).toBe("Name?");
 * await hil.resume(threadId, "Ada");
 * ```
 */
export async function collectUntilInterrupt<TChunk>(
  iterable: AsyncIterable<TChunk>,
): Promise<CollectedUntilInterrupt<TChunk>> {
  const chunks: TChunk[] = [];
  let interrupts: readonly StreamInterrupt[] | undefined;
  for await (const chunk of iterable) {
    const found = getStreamedInterrupts(chunk);
    if (found) {
      interrupts = found;
      break;
    }
    chunks.push(chunk);
  }
  return { chunks, interrupts };
}
