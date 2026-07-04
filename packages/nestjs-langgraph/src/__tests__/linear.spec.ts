import { Injectable } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";

import {
  LangGraphModule,
  InjectLangGraphRunnable,
  type LangGraphRunnable,
} from "../index";
import {
  CounterStateT,
  IncrementService,
  LinearGraph,
  NodeA,
  NodeB,
} from "./fixtures";

@Injectable()
class LinearConsumer {
  constructor(
    @InjectLangGraphRunnable(LinearGraph)
    public readonly graph: LangGraphRunnable<CounterStateT>,
  ) {}
}

describe("LangGraph linear graph", () => {
  let app: INestApplication;
  let consumer: LinearConsumer;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot(),
        LangGraphModule.forFeature([LinearGraph]),
      ],
      providers: [IncrementService, NodeA, NodeB, LinearConsumer],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    consumer = app.get(LinearConsumer);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("flows state START -> NodeA -> NodeB -> END with DI inside nodes", async () => {
    const result = await consumer.graph.invoke({ steps: [], total: 0 });
    expect(result.steps).toEqual(["A", "B"]);
    // IncrementService was injected into both nodes and called once each.
    expect(result.total).toBe(2);
  });

  it("exposes an injectable facade via @InjectLangGraphRunnable", () => {
    expect(typeof consumer.graph.invoke).toBe("function");
    expect(typeof consumer.graph.stream).toBe("function");
    expect(typeof consumer.graph.resume).toBe("function");
  });
});
