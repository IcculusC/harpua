/**
 * Type-level tests for the streaming facade surface. Compiled by tsc via
 * type-safety.spec.ts. `@ts-expect-error` lines assert genuine compile errors;
 * `expectType` pins the yielded chunk type per helper.
 */
import type { BaseMessage } from "@langchain/core/messages";
import type {
  LangGraphRunnable,
  NodeUpdate,
  MessageChunk,
  ModeChunk,
} from "./index";

interface DemoState {
  count: number;
  log: string[];
}

/** Asserts `T` is exactly `Expected` (bidirectional assignability). */
function expectType<Expected>() {
  return <T extends Expected>(_v: T & ([Expected] extends [T] ? unknown : never)) =>
    _v;
}

declare const runnable: LangGraphRunnable<DemoState>;

async function assertStreamTypes() {
  // stream() and streamUpdates() -> NodeUpdate<DemoState> per chunk.
  for await (const chunk of await runnable.stream({})) {
    expectType<NodeUpdate<DemoState>>()(chunk);
  }
  for await (const chunk of await runnable.streamUpdates({})) {
    expectType<NodeUpdate<DemoState>>()(chunk);
  }

  // streamValues() -> full DemoState snapshots.
  for await (const chunk of await runnable.streamValues({})) {
    expectType<DemoState>()(chunk);
    const n: number = chunk.count;
    void n;
  }

  // streamMessages() -> [message, metadata].
  for await (const chunk of await runnable.streamMessages({})) {
    expectType<MessageChunk>()(chunk);
    const msg: BaseMessage = chunk[0];
    void msg;
  }

  // streamModes() -> discriminated [mode, chunk] union over the requested modes.
  for await (const chunk of await runnable.streamModes({}, [
    "updates",
    "values",
  ])) {
    expectType<ModeChunk<DemoState, "updates" | "values">>()(chunk);
    if (chunk[0] === "values") {
      const s: DemoState = chunk[1];
      void s;
    } else {
      const u: NodeUpdate<DemoState> = chunk[1];
      void u;
    }
  }
}
void assertStreamTypes;

// streamModes rejects a non-StreamMode literal.
// @ts-expect-error "bogus" is not a StreamMode.
void runnable.streamModes({}, ["bogus"]);

export {};
