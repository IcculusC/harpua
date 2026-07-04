import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";

import {
  LangGraphModule,
  getGraphFacadeToken,
  type LangGraphRunnable,
} from "../index";
import {
  ChildOne,
  ChildTwo,
  ParentGraph,
  StepOne,
  StepTwo,
} from "./fixtures";

describe("LangGraph subgraph composition", () => {
  let app: INestApplication;
  let parent: LangGraphRunnable;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot(),
        // Children must be registered so the registry can resolve their edges.
        LangGraphModule.forFeature([ParentGraph, ChildOne, ChildTwo]),
      ],
      providers: [StepOne, StepTwo],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    parent = app.get<LangGraphRunnable>(getGraphFacadeToken({ name: "parent" }));
  });

  afterAll(async () => {
    await app?.close();
  });

  it("composes a parent graph containing two subgraph nodes", async () => {
    const result = await parent.invoke({ trail: [] });
    expect(result.trail).toEqual(["one", "two"]);
  });
});
