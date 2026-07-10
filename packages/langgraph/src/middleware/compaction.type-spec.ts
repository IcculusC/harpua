/**
 * Type-level test for compaction options + the `z.input` partial-literal
 * ergonomics of `provideCompaction`/`provideManagedContext`. Compiled by tsc
 * (see type-safety.spec.ts / tsconfig.type-test.json), not by jest.
 */
import type { CompactionOptions } from "../index";
import { CompactionSummarySchema, provideCompaction, provideManagedContext } from "../index";

// A drop config and a summarize config must both satisfy the parsed options type.
const _drop: CompactionOptions = { triggerAt: { messages: 40 }, keepRecent: 20, strategy: "drop" };
// `strategy.schema` is `.default(CompactionSummarySchema)` in compaction.options.ts, which makes
// it a required field of the *parsed* (z.infer) output type, not the pre-parse input a caller
// hands to `provideCompaction`/`provideManagedContext` (see the z.input assertions below) — so
// it must be supplied here for `_sum` to satisfy `CompactionOptions`.
const _sum: CompactionOptions = {
  triggerAt: (s) => s.messageCount > 40,
  keepRecent: 20,
  strategy: { kind: "summarize", model: Symbol.for("m"), schema: CompactionSummarySchema },
};

// Partial-literal `provide*` calls must typecheck: callers may omit defaulted
// fields (cacheHints/evictToolOutputs/strategy) because both functions accept
// the zod INPUT type, not the parsed/defaulted output type.
const _compactionProviders = provideCompaction({ triggerAt: { messages: 5 }, keepRecent: 2 });
const _managedContextProviders = provideManagedContext({
  triggerAt: { tokens: 1000 },
  keepRecent: 4,
});

void _drop;
void _sum;
void _compactionProviders;
void _managedContextProviders;

export {};
