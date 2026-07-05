import { CLOCK, fixedClock, provideFixedClock } from "../clock";
import {
  createGraphTestingModule,
  type GraphTestingHarness,
} from "../testing-module";
import { StampGraph, StampNode, type StampStateT } from "./fixtures";

describe("fixedClock", () => {
  it("returns the same instant on every now() call", () => {
    const clock = fixedClock("2026-07-04T00:00:00Z");
    expect(clock.now().toISOString()).toBe("2026-07-04T00:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-07-04T00:00:00.000Z");
  });

  it("hands out fresh Date objects so callers cannot mutate the fixed value", () => {
    const clock = fixedClock("2026-07-04T00:00:00Z");
    const first = clock.now();
    first.setFullYear(1999);
    expect(clock.now().toISOString()).toBe("2026-07-04T00:00:00.000Z");
  });

  it("accepts a date-only string as UTC midnight", () => {
    expect(fixedClock("2026-07-04").now().toISOString()).toBe(
      "2026-07-04T00:00:00.000Z",
    );
  });

  it("rejects a malformed instant via zod", () => {
    expect(() => fixedClock("not-a-date")).toThrow();
  });
});

describe("provideFixedClock in a real graph", () => {
  let harness: GraphTestingHarness;

  afterEach(async () => {
    await harness?.close();
  });

  it("makes a node's now() deterministic through DI", async () => {
    harness = await createGraphTestingModule({
      graphs: [StampGraph],
      providers: [StampNode, provideFixedClock("2026-07-04T12:00:00Z")],
    });
    const graph = harness.get<StampStateT>(StampGraph);
    const result = await graph.invoke({ stamps: [] });
    expect(result.stamps).toEqual(["2026-07-04T12:00:00.000Z"]);
  });

  it("binds the CLOCK token to the fixed clock", async () => {
    harness = await createGraphTestingModule({
      graphs: [StampGraph],
      providers: [StampNode, provideFixedClock("2026-01-01T00:00:00Z")],
    });
    const clock = harness.app.get(CLOCK);
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});
