import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";

/** Make a fresh temp directory; realpath it so macOS `/var`→`/private/var` is stable. */
export function makeTmpDir(prefix = "agent-tools-"): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** Best-effort recursive cleanup of a temp tree. */
export function removeTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Write a text file (creating parent dirs), returning its absolute path. */
export function writeFile(root: string, rel: string, contents: string): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
  return abs;
}

/** Write a binary file containing a NUL byte, returning its absolute path. */
export function writeBinaryFile(root: string, rel: string): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.from([0x89, 0x50, 0x00, 0x4e, 0x47, 0x0a]));
  return abs;
}

/** Build a numbered text file: `line01\nline02\n…` with `count` lines + trailing newline. */
export function numberedLines(count: number): string {
  const lines: string[] = [];
  for (let i = 1; i <= count; i++) lines.push(`line${String(i).padStart(2, "0")}`);
  return lines.join("\n") + "\n";
}

/** Invoke a tool and return its textual result (coercing a ToolMessage). */
export async function runTool(
  tool: StructuredToolInterface,
  input: unknown,
): Promise<string> {
  const result = (await tool.invoke(input as never)) as ToolMessage | string;
  const content = result instanceof ToolMessage ? result.content : result;
  return typeof content === "string" ? content : JSON.stringify(content);
}
