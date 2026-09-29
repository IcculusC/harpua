import { createRequire } from "node:module";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { requireOptionalModule, requirePeerOf } from "../optional-require.js";

// The optional peers must resolve from the host package (this package's own
// node_modules, where a consumer installs them), not from wherever the built
// file happens to sit. `createRequire(import.meta.url)` in optional-require.ts
// is what makes that true in ESM output.
const hostRequire = createRequire(path.join(import.meta.dirname, "..", "..", "package.json"));

describe("optional-require resolves from the host package", () => {
  it("requireOptionalModule returns the host's copy of an optional peer", () => {
    const saver = "@langchain/langgraph-checkpoint-sqlite";
    expect(requireOptionalModule(saver)).toBe(hostRequire(saver));
  });

  it("requirePeerOf resolves a driver relative to the peer that ships it", () => {
    const host = "@langchain/langgraph-checkpoint-mongodb";
    const viaHost = createRequire(hostRequire.resolve(host))("mongodb");
    expect(requirePeerOf("mongodb", host)).toBe(viaHost);
  });

  it("stays synchronous", () => {
    expect(requireOptionalModule("@langchain/langgraph-checkpoint-sqlite")).not.toBeInstanceOf(
      Promise,
    );
  });
});
