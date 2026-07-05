import { expectInterrupt } from "../interrupt-helpers";
import {
  createGraphTestingModule,
  type GraphTestingHarness,
} from "../testing-module";
import { AskHumanNode, HilGraph, type HilStateT } from "./fixtures";

describe("expectInterrupt", () => {
  let harness: GraphTestingHarness;

  afterEach(async () => {
    await harness?.close();
  });

  it("extracts the interrupt payload from a paused invoke, pairing with resume", async () => {
    harness = await createGraphTestingModule({
      graphs: [HilGraph],
      providers: [AskHumanNode],
    });
    const hil = harness.get<HilStateT>(HilGraph);
    const threadId = "expect-hil-1";

    const paused = await hil.invoke(
      { question: "What is your name?", answer: "" },
      { configurable: { thread_id: threadId } },
    );

    const question = expectInterrupt<string>(paused);
    expect(question).toBe("What is your name?");

    const done = await hil.resume(threadId, "Ada");
    expect(done.answer).toBe("Ada");
  });

  it("throws a helpful error when the result did not interrupt", () => {
    expect(() => expectInterrupt({ answer: "done" })).toThrow(
      /expected an interrupted graph result/,
    );
  });

  it("names the available keys in the error message", () => {
    expect(() => expectInterrupt({ answer: "done", question: "q" })).toThrow(
      /\[answer, question\]/,
    );
  });
});
