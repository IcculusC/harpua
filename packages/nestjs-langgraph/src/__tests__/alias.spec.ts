import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";

import {
  LangGraphModule,
  getGraphFacadeToken,
  type LangGraphRunnable,
} from "../index";
import { AliasedGraph, Appender } from "./fixtures";

describe("LangGraph node aliasing via as()", () => {
  let app: INestApplication;
  let aliased: LangGraphRunnable;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot(),
        LangGraphModule.forFeature([AliasedGraph]),
      ],
      providers: [Appender],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    aliased = app.get<LangGraphRunnable>(
      getGraphFacadeToken({ name: "aliased" }),
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it("mounts the same node class twice under distinct aliased ids", async () => {
    const result = await aliased.invoke({ trail: [] });
    // Appender ran twice: once as 'first', once as 'second'.
    expect(result.trail).toEqual(["*", "*"]);
  });
});
