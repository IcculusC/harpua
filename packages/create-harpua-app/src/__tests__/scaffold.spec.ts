import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { scaffold, ScaffoldError } from "../cli";

const TEMPLATE_DIR = path.resolve(__dirname, "..", "..", "template");

function tmpParent(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "create-harpua-app-"));
}

describe("scaffold", () => {
  let workdir: string;

  beforeEach(() => {
    workdir = tmpParent();
  });

  afterEach(() => {
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("copies the template into the target directory", () => {
    const target = path.join(workdir, "my-agent");
    const result = scaffold({ targetDir: target, templateDir: TEMPLATE_DIR });

    expect(fs.existsSync(path.join(target, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(target, "src", "main.ts"))).toBe(true);
    expect(
      fs.existsSync(path.join(target, "src", "agent", "weather.tools.ts")),
    ).toBe(true);
    // The relative file list is reported and sorted.
    expect(result.files).toContain("package.json");
    expect(result.files).toEqual([...result.files].sort());
  });

  it("renames the template's `gitignore` to `.gitignore`", () => {
    const target = path.join(workdir, "my-agent");
    scaffold({ targetDir: target, templateDir: TEMPLATE_DIR });

    // The dotfile is present under its real name...
    expect(fs.existsSync(path.join(target, ".gitignore"))).toBe(true);
    // ...and the un-dotted source name never leaks into the project.
    expect(fs.existsSync(path.join(target, "gitignore"))).toBe(false);
  });

  it("sets the scaffolded package.json name to the target basename", () => {
    const target = path.join(workdir, "weather-bot");
    const result = scaffold({ targetDir: target, templateDir: TEMPLATE_DIR });

    const pkg = JSON.parse(
      fs.readFileSync(path.join(target, "package.json"), "utf8"),
    ) as { name: string };
    expect(pkg.name).toBe("weather-bot");
    expect(result.appName).toBe("weather-bot");
  });

  it("does not copy build output or dependency directories", () => {
    const target = path.join(workdir, "my-agent");
    scaffold({ targetDir: target, templateDir: TEMPLATE_DIR });

    expect(fs.existsSync(path.join(target, "node_modules"))).toBe(false);
    expect(fs.existsSync(path.join(target, "dist"))).toBe(false);
  });

  it("refuses a non-empty existing target directory", () => {
    const target = path.join(workdir, "occupied");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "keep.txt"), "hi");

    expect(() =>
      scaffold({ targetDir: target, templateDir: TEMPLATE_DIR }),
    ).toThrow(ScaffoldError);
    expect(() =>
      scaffold({ targetDir: target, templateDir: TEMPLATE_DIR }),
    ).toThrow(/not empty/);
  });

  it("scaffolds into an existing but empty directory", () => {
    const target = path.join(workdir, "empty");
    fs.mkdirSync(target, { recursive: true });

    expect(() =>
      scaffold({ targetDir: target, templateDir: TEMPLATE_DIR }),
    ).not.toThrow();
    expect(fs.existsSync(path.join(target, "package.json"))).toBe(true);
  });

  it("rejects a target basename that is not a valid npm package name", () => {
    const target = path.join(workdir, "My Agent");

    expect(() =>
      scaffold({ targetDir: target, templateDir: TEMPLATE_DIR }),
    ).toThrow(ScaffoldError);
    expect(() =>
      scaffold({ targetDir: target, templateDir: TEMPLATE_DIR }),
    ).toThrow(/not a valid project name/);
    // Nothing was written for the invalid name.
    expect(fs.existsSync(target)).toBe(false);
  });
});
