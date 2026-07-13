import fs from "node:fs";

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { createSandbox, SandboxError, SecretPathError, type Sandbox } from "../file-exploration/sandbox";
import { looksBinary } from "../file-exploration/file-info";
import { skillToolOptionsSchema, listSkills, type SkillToolOptions } from "./options";

const DESCRIPTION =
  "Read one reference file belonging to a skill. This is its own file tree, " +
  "separate from any project sandbox — a skill's file is unreachable without " +
  "naming its skill, and paths are relative to that skill's own directory. " +
  "use_skill lists each reference with its size in lines; pass startLine/" +
  "endLine to read just the part you need.";

const readSkillFileInputSchema = z.object({
  skill: z.string().min(1).describe("The owning skill's name, as listed in your SKILLS menu."),
  path: z
    .string()
    .min(1)
    .describe("Reference file path, relative to the skill's own directory. Relative only."),
  startLine: z.number().int().positive().optional().describe("1-based first line (default 1)."),
  endLine: z.number().int().positive().optional().describe("1-based last line, inclusive."),
});

/** One read never exceeds this many lines — progressive disclosure is
 *  enforced structurally, not by asking nicely (a greedy reader once pulled a
 *  1026-line reference in six widening windows when a prompt was the guard). */
const READ_CAP_LINES = 2_000;
/** …nor this many content bytes. */
const READ_CAP_BYTES = 64 * 1024;
/** Files past this size are refused outright (before buffering). */
const MAX_FILE_BYTES = 1_048_576;

/**
 * `read_skill_file` — capped, line-numbered reads out of a PER-SKILL jail:
 * the sandbox root is the skill's own directory, so `../other-skill/…` (or
 * anything outside it) cannot resolve, symlinks included.
 */
export function readSkillFileTool(options: SkillToolOptions): StructuredToolInterface {
  const { registry } = skillToolOptionsSchema.parse(options);
  // One sandbox per skill dir, built lazily and kept for the tool's lifetime.
  const jails = new Map<string, Sandbox>();

  return tool(
    ({ skill: skillName, path: input, startLine, endLine }) => {
      const skill = registry.menu().find((s) => s.name === skillName);
      if (!skill) return `No skill named "${skillName}".\n\n${listSkills(registry)}`;

      let jail = jails.get(skill.dir);
      if (!jail) {
        try {
          jail = createSandbox(skill.dir);
        } catch {
          // The skill was uninstalled after the last scan — refuse, don't
          // crash (the menu is stale until the consumer rescan()s).
          return `Skill "${skillName}" is no longer available on disk — its files are gone. Rescan your skills.`;
        }
        jails.set(skill.dir, jail);
      }

      let abs: string;
      try {
        abs = jail.resolve(input);
      } catch (err) {
        // Order matters: SecretPathError subclasses SandboxError, and the
        // traversal message would misdiagnose a correct path as malformed.
        if (err instanceof SecretPathError) return err.message;
        if (err instanceof SandboxError) {
          return (
            `Paths are relative to the "${skillName}" skill's own directory — ` +
            `no leading "/", no "..". use_skill("${skillName}") lists its files.`
          );
        }
        throw err;
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        return `No file at ${input} in skill "${skillName}" — use_skill("${skillName}") lists what exists.`;
      }
      if (stat.isDirectory()) return `"${input}" is a directory — name one of the files inside it.`;
      if (stat.size > MAX_FILE_BYTES) {
        return `"${input}" is ${stat.size} bytes — too big to read through this tool.`;
      }

      const buf = fs.readFileSync(abs);
      if (looksBinary(buf)) return `"${input}" looks binary — not readable as text.`;

      const allLines = buf.toString("utf8").split("\n");
      if (allLines.length > 0 && allLines[allLines.length - 1] === "") allLines.pop();
      const total = allLines.length;
      if (total === 0) return `${input} — empty file (0 lines).`;

      const from = Math.max(1, startLine ?? 1);
      const to = Math.min(total, endLine ?? total);
      if (from > total || to < from) {
        return `"${input}" has ${total} lines — pass startLine/endLine within 1–${total}.`;
      }

      const width = String(to).length;
      const out: string[] = [];
      let bytes = 0;
      let emitted = 0;
      let stoppedAt = to;
      for (let n = from; n <= to; n++) {
        let line = `${String(n).padStart(width)}  ${allLines[n - 1]}`;
        let lineBytes = Buffer.byteLength(line, "utf8");
        // A single line over the whole byte budget is hard-truncated and
        // emitted — refusing it with a "pass startLine=n" hint that names
        // the very line just refused would be an unbreakable retry loop.
        if (lineBytes > READ_CAP_BYTES) {
          let cut = line.slice(0, READ_CAP_BYTES);
          while (Buffer.byteLength(cut, "utf8") > READ_CAP_BYTES) {
            cut = cut.slice(0, Math.floor(cut.length * 0.9));
          }
          line = `${cut} … (line truncated — it exceeds the per-read byte cap)`;
          lineBytes = Buffer.byteLength(line, "utf8");
        }
        if (emitted > 0 && (emitted >= READ_CAP_LINES || bytes + lineBytes > READ_CAP_BYTES)) {
          stoppedAt = n - 1;
          out.push(`… truncated — pass startLine=${n} to continue (${total} lines total).`);
          break;
        }
        out.push(line);
        bytes += lineBytes + 1;
        emitted++;
      }

      return `${input} — lines ${from}–${stoppedAt} of ${total}\n${out.join("\n")}`;
    },
    { name: "read_skill_file", description: DESCRIPTION, schema: readSkillFileInputSchema },
  );
}
