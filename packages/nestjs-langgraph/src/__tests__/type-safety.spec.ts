import { execFileSync } from "node:child_process";
import * as path from "node:path";

/**
 * Real type-level test: runs `tsc` over the type-spec file. The type-spec relies
 * on `@ts-expect-error` for the incompatible-node cases, so tsc exits 0 only if
 * every rejection is still in force (and every accepted case still compiles).
 */
describe("defineEdges type-level state compatibility", () => {
  const pkgRoot = path.resolve(__dirname, "..", "..");

  it("compiles the type-spec cleanly (@ts-expect-error rejections hold)", () => {
    let output = "";
    try {
      execFileSync(
        "npx",
        ["tsc", "-p", "tsconfig.type-test.json"],
        { cwd: pkgRoot, stdio: "pipe", encoding: "utf8" },
      );
    } catch (err: any) {
      output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
      throw new Error(`tsc reported type errors:\n${output}`);
    }
    expect(output).toBe("");
  });
});
