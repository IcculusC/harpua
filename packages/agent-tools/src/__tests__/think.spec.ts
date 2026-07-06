import { StructuredTool } from "@langchain/core/tools";
import { ToolMessage } from "@langchain/core/messages";
import { z } from "zod";

import { thinkTool } from "../think";

describe("thinkTool", () => {
  it("produces a StructuredTool named 'think' with a { thought: string } schema", () => {
    const t = thinkTool();

    expect(t).toBeInstanceOf(StructuredTool);
    expect(t.name).toBe("think");
    // Schema accepts a string thought and rejects anything else.
    const schema = t.schema as z.ZodType;
    expect(schema.safeParse({ thought: "reasoning" }).success).toBe(true);
    expect(schema.safeParse({ thought: 42 }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("returns an empty string from its handler (a no-op scratchpad)", async () => {
    const t = thinkTool();

    const result = (await t.invoke({ thought: "I should pause here" })) as
      | ToolMessage
      | string;
    const content = result instanceof ToolMessage ? result.content : result;
    expect(content).toBe("");
  });

  it("uses a solid default description and lets consumers override it", () => {
    const def = thinkTool();
    expect(def.description.length).toBeGreaterThan(0);
    expect(def.description).toMatch(/reason|think/i);

    const custom = thinkTool({ description: "Think about refund policy conflicts." });
    expect(custom.description).toBe("Think about refund policy conflicts.");
  });

  it("validates options with zod, rejecting bad shapes", () => {
    // Wrong type for a known option.
    expect(() => thinkTool({ description: 42 as unknown as string })).toThrow();
    // Empty override is not a usable description.
    expect(() => thinkTool({ description: "" })).toThrow();
    // Unknown keys are rejected (strict).
    expect(() =>
      thinkTool({ whenToThink: "always" } as unknown as Record<string, never>),
    ).toThrow();
  });
});
