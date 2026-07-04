import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { StateSnapshot } from "@langchain/langgraph";

import {
  LangGraphModule,
  getGraphFacadeToken,
  type LangGraphRunnable,
} from "../index";
import {
  CounterStateT,
  IncrementService,
  LinearGraph,
  NodeA,
  NodeB,
} from "./fixtures";

/**
 * Exercises the time-travel primitives against the real compiled graph
 * (SQLite `:memory:`, no live server): `getStateHistory` yields the checkpoint
 * trail newest-first, and a `checkpoint_id` pulled from that trail can be
 * replayed via `invoke` to fork the run from an earlier super-step.
 */
describe("Facade getStateHistory + checkpoint replay", () => {
  let app: INestApplication;
  let graph: LangGraphRunnable<CounterStateT>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot({
          checkpointer: { type: "sqlite", path: ":memory:" },
        }),
        LangGraphModule.forFeature([LinearGraph]),
      ],
      providers: [IncrementService, NodeA, NodeB],
    }).compile();
    app = moduleRef.createNestApplication();
    app.enableShutdownHooks();
    await app.init();
    graph = app.get<LangGraphRunnable<CounterStateT>>(
      getGraphFacadeToken({ name: "linear" }),
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  async function collectHistory(threadId: string): Promise<StateSnapshot[]> {
    const config = { configurable: { thread_id: threadId } };
    const snapshots: StateSnapshot[] = [];
    for await (const s of graph.getStateHistory(config)) {
      snapshots.push(s);
    }
    return snapshots;
  }

  it("yields multiple snapshots for a thread, newest first", async () => {
    const threadId = "history-thread-1";
    const config = { configurable: { thread_id: threadId } };

    // Two runs on one thread => several checkpoints (one per super-step, twice).
    await graph.invoke({ steps: [], total: 0 }, config);
    await graph.invoke({ steps: [], total: 0 }, config);

    const snapshots = await collectHistory(threadId);
    expect(snapshots.length).toBeGreaterThan(1);

    // Newest first: the head snapshot is a completed run (nothing left to do)
    // and every snapshot is at least as new as the one after it.
    expect(snapshots[0].next).toEqual([]);
    for (let i = 0; i < snapshots.length - 1; i++) {
      const cur = snapshots[i].createdAt ?? "";
      const nxt = snapshots[i + 1].createdAt ?? "";
      expect(cur >= nxt).toBe(true);
    }

    // Each snapshot exposes a checkpoint_id in its config — the replay coordinate.
    for (const s of snapshots) {
      const cfg = s.config.configurable as Record<string, unknown>;
      expect(typeof cfg.checkpoint_id).toBe("string");
    }
  });

  it("replays/forks a run from a historical checkpoint_id", async () => {
    const threadId = "history-thread-2";
    const config = { configurable: { thread_id: threadId } };

    await graph.invoke({ steps: [], total: 0 }, config);
    const snapshots = await collectHistory(threadId);

    // Find the snapshot captured just before NodeB runs (state after NodeA).
    const beforeB = snapshots.find((s) => s.next.includes("NodeB"));
    expect(beforeB).toBeDefined();
    const checkpointId = (beforeB!.config.configurable as Record<string, unknown>)
      .checkpoint_id as string;
    expect(typeof checkpointId).toBe("string");
    // At that point NodeA has run once but NodeB has not.
    expect((beforeB!.values as CounterStateT).steps).toEqual(["A"]);

    // Replay from that checkpoint: passing null input resumes the pending work
    // (NodeB) from the forked point and runs to completion.
    const replayed = (await graph.invoke(null, {
      configurable: { thread_id: threadId, checkpoint_id: checkpointId },
    })) as CounterStateT;
    expect(replayed.steps).toEqual(["A", "B"]);
    expect(replayed.total).toBe(2);
  });
});
