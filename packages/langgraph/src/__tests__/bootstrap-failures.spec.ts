import { Injectable } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { z } from "zod";

import {
  LangGraphModule,
  LangGraph,
  NodeHandler,
  defineEdges,
  START,
  END,
  TOOLS,
  as,
} from "../index";

const State = z.object({ trail: z.array(z.string()) });
type StateT = z.infer<typeof State>;

@Injectable()
class Orphan implements NodeHandler<StateT> {
  run(s: StateT) {
    return s;
  }
}

@Injectable()
class Present implements NodeHandler<StateT> {
  run(s: StateT) {
    return s;
  }
}

@LangGraph({ name: "brokenMissing", state: State })
class MissingProviderGraph {
  edges = defineEdges<StateT>([
    { from: START, to: Orphan },
    { from: Orphan, to: END },
  ]);
}

@LangGraph({ name: "brokenTools", state: State })
class ToolsWithoutConfigGraph {
  edges = defineEdges<StateT>([
    { from: START, to: TOOLS },
    { from: TOOLS, to: END },
  ]);
}

@LangGraph({ name: "brokenDup", state: State })
class DuplicateIdGraph {
  edges = defineEdges<StateT>([
    // Two different node classes forced under the same id 'dup'.
    { from: START, to: as("dup", Present) },
    { from: as("dup", Orphan), to: END },
  ]);
}

async function bootstrap(graph: any, providers: any[] = []): Promise<void> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      LangGraphModule.forRoot(),
      LangGraphModule.forFeature([graph]),
    ],
    providers,
  }).compile();
  const app = moduleRef.createNestApplication();
  try {
    await app.init();
  } finally {
    await app.close();
  }
}

describe("LangGraph bootstrap fail-fast validation", () => {
  it("errors when a referenced node is not provided in any module", async () => {
    await expect(bootstrap(MissingProviderGraph)).rejects.toThrow(
      /Orphan is referenced by graph 'brokenMissing' but not provided in any module/,
    );
  });

  it("errors when TOOLS is referenced but no tool providers are configured", async () => {
    await expect(bootstrap(ToolsWithoutConfigGraph)).rejects.toThrow(
      /references the TOOLS node but no tool providers were configured/,
    );
  });

  it("errors on a duplicate node id", async () => {
    await expect(bootstrap(DuplicateIdGraph, [Present, Orphan])).rejects.toThrow(
      /Duplicate node id 'dup'/,
    );
  });
});
