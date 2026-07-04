import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";

import {
  LangGraphModule,
  getGraphFacadeToken,
  type LangGraphRunnable,
} from "../index";
import {
  LogStamp,
  ReuseGraphOne,
  ReuseGraphTwo,
  SetAlpha,
  SetBeta,
} from "./fixtures";

describe("LangGraph node reuse across graphs", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot(),
        LangGraphModule.forFeature([ReuseGraphOne, ReuseGraphTwo]),
      ],
      providers: [LogStamp, SetAlpha, SetBeta],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("uses the same narrow-slice node in two graphs with different composite state", async () => {
    const one = app.get<LangGraphRunnable>(
      getGraphFacadeToken({ name: "reuseOne" }),
    );
    const two = app.get<LangGraphRunnable>(
      getGraphFacadeToken({ name: "reuseTwo" }),
    );

    expect(await one.invoke({ log: [], alpha: "" })).toEqual({
      log: ["stamp"],
      alpha: "set",
    });
    expect(await two.invoke({ log: [], beta: 0 })).toEqual({
      log: ["stamp"],
      beta: 99,
    });
  });
});
