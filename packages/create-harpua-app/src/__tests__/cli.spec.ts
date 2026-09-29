import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { parseArgs, readVersion, scaffold } from "../cli.js";

const PKG_ROOT = path.resolve(import.meta.dirname, "..", "..");
const TEMPLATE_DIR = path.join(PKG_ROOT, "template");
const CLI_SRC = path.join(PKG_ROOT, "src", "cli.ts");

describe("parseArgs", () => {
  it("recognises --help and -h", () => {
    expect(parseArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseArgs(["-h"])).toEqual({ kind: "help" });
    expect(parseArgs(["my-agent", "--help"])).toEqual({ kind: "help" });
  });

  it("recognises --version and -v", () => {
    expect(parseArgs(["--version"])).toEqual({ kind: "version" });
    expect(parseArgs(["-v"])).toEqual({ kind: "version" });
  });

  it("parses a single target directory", () => {
    expect(parseArgs(["my-agent"])).toEqual({
      kind: "scaffold",
      targetArg: "my-agent",
    });
  });

  it("rejects unknown flags", () => {
    expect(parseArgs(["--bogus"])).toEqual({
      kind: "error",
      message: 'unknown option "--bogus"',
    });
    expect(parseArgs(["my-agent", "-x"]).kind).toBe("error");
  });

  it("rejects a missing or extra target", () => {
    expect(parseArgs([]).kind).toBe("error");
    expect(parseArgs(["a", "b"]).kind).toBe("error");
  });
});

describe("readVersion", () => {
  it("reads the package.json version", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"),
    ) as { version: string };
    expect(readVersion()).toBe(pkg.version);
  });
});

describe("cli process", () => {
  const run = (...args: string[]) =>
    spawnSync(
      process.execPath,
      ["--experimental-strip-types", CLI_SRC, ...args],
      {
        encoding: "utf8",
      },
    );

  it("prints usage and exits 0 for --help", () => {
    const r = run("--help");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Usage: create-harpua-app <target-dir>");
    expect(r.stdout).toContain("Next steps");
  });

  it("prints the version and exits 0 for --version", () => {
    const r = run("--version");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(readVersion());
  });

  it("errors with usage and exits 1 for an unknown flag", () => {
    const r = run("--bogus");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unknown option "--bogus"');
    expect(r.stderr).toContain("Usage: create-harpua-app");
  });
});

describe("project name substitution", () => {
  it("stamps the project name into the README and leaves no placeholder or stale name", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "create-harpua-app-"));
    try {
      const target = path.join(parent, "weather-bot");
      scaffold({ targetDir: target, templateDir: TEMPLATE_DIR });
      const readme = fs.readFileSync(path.join(target, "README.md"), "utf8");
      expect(readme.split("\n")[0]).toBe("# weather-bot");
      expect(readme).not.toContain("{{PROJECT_NAME}}");
      expect(readme).not.toContain("harpua-weather-agent");
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it("template @harpua/* ranges are stable ^1.0.0, not prereleases", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(TEMPLATE_DIR, "package.json"), "utf8"),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const ranges = Object.entries({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    })
      .filter(([n]) => n.startsWith("@harpua/"))
      .map(([, v]) => v);
    expect(ranges.length).toBeGreaterThan(0);
    for (const r of ranges) expect(r).toBe("^1.0.0");
  });
});
