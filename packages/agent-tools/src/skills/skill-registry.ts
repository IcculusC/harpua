import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { parseFrontmatter } from "./frontmatter";
import { renderSkillMenu } from "./render-skill-menu";
import { DEFAULT_SECRET_PATTERNS, isSecretPath } from "../file-exploration/secret-paths";

/** One discovered skill: the menu entry plus its jail root. */
export interface Skill {
  name: string;
  description: string;
  /** Absolute path of the skill's own directory — the per-skill jail root. */
  dir: string;
}

/** A reference file a skill ships: dir-relative path + its cost in lines. */
export interface SkillRef {
  path: string;
  lines: number;
}

/** What `rescan()` reports back to the caller (a `/skills` command, a TUI). */
export interface SkillRescanResult {
  count: number;
  names: string[];
  skipped: number;
  /** Whether the RENDERED menu bytes changed — a `true` here means the next
   *  model call's system prompt moves and the provider's prefix cache resets. */
  changed: boolean;
}

export interface SkillRegistryOptions {
  /** Receives one message per skipped entry (malformed, symlinked, oversized).
   *  Defaults to `console.warn`; inject a sink in tests. */
  onWarn?: (message: string) => void;
}

/** A SKILL.md body larger than this is a doc dump, not a procedure. */
const SKILL_BODY_CAP_BYTES = 16_384;
/** Streamed line counting so a huge reference never gets buffered whole. */
const COUNT_CHUNK_BYTES = 64 * 1024;

const SkillFrontmatter = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().min(1),
});

/** Count lines without buffering the file: newline bytes + an unterminated tail. */
function countLines(abs: string): number {
  const fd = fs.openSync(abs, "r");
  try {
    const buf = Buffer.alloc(COUNT_CHUNK_BYTES);
    let newlines = 0;
    let lastByte = 0x0a; // empty file -> 0 lines
    let bytesRead: number;
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      for (let i = 0; i < bytesRead; i++) if (buf[i] === 0x0a) newlines++;
      lastByte = buf[bytesRead - 1] ?? lastByte;
    }
    return newlines + (lastByte === 0x0a ? 0 : 1);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Discovers skills for the app's OWN agent at runtime: scans a directory of
 * `<skill>/SKILL.md` files (frontmatter `name` + `description`), serves the
 * menu, bodies, and reference listings (paths + line counts, never contents),
 * and `rescan()`s mid-session so a skill installed while the agent runs is on
 * the menu for its next turn. Malformed, symlinked, or oversized entries are
 * skipped with a warning — never a crash: a broken vendored skill must not
 * take the agent down. Plain class, framework-free; wire it behind DI (and a
 * `wrapModelCall` menu middleware) in the consuming app.
 */
export class SkillRegistry {
  private skills: Skill[] = [];
  private bodies = new Map<string, string>();
  private lastSkipped = 0;

  constructor(
    private readonly dir: string,
    private readonly opts: SkillRegistryOptions = {},
  ) {
    this.scan();
  }

  /** The discovered skills, sorted by name (stable menu bytes). A copy —
   *  a caller's sort/reverse must not corrupt registry order or fake a
   *  `changed` signal on the next rescan. */
  menu(): Skill[] {
    return [...this.skills];
  }

  has(name: string): boolean {
    return this.bodies.has(name);
  }

  /** The SKILL.md body (frontmatter included), or null for an unknown name. */
  body(name: string): string | null {
    return this.bodies.get(name) ?? null;
  }

  /** Every file under the skill's dir EXCEPT SKILL.md, with line counts —
   *  the cost is stated so a reader can budget before spending a read. */
  references(name: string): SkillRef[] {
    const skill = this.skills.find((s) => s.name === name);
    if (!skill) return [];
    const refs: SkillRef[] = [];
    const walk = (abs: string, rel: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(abs, { withFileTypes: true });
      } catch {
        return; // partial listing beats a crash mid-walk
      }
      for (const entry of entries) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        // Secret-named files are never LISTED either: the read tool refuses
        // them, and advertising existence + line count is itself a leak.
        if (isSecretPath(childRel, DEFAULT_SECRET_PATTERNS)) continue;
        if (entry.isDirectory()) walk(path.join(abs, entry.name), childRel);
        else if (entry.isFile() && childRel !== "SKILL.md") {
          try {
            refs.push({ path: childRel, lines: countLines(path.join(abs, entry.name)) });
          } catch {
            /* unreadable reference: omit it rather than crash */
          }
        }
      }
    };
    walk(skill.dir, "");
    return refs.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Re-scan the directory; `changed` compares RENDERED menu bytes so the
   *  caller knows whether the next call's system prompt (and prompt cache)
   *  actually moves. */
  rescan(): SkillRescanResult {
    const before = renderSkillMenu(this.skills);
    this.scan();
    return {
      count: this.skills.length,
      names: this.skills.map((s) => s.name),
      skipped: this.lastSkipped,
      changed: renderSkillMenu(this.skills) !== before,
    };
  }

  private warn(message: string): void {
    (this.opts.onWarn ?? console.warn)(`skills: ${message}`);
  }

  private scan(): void {
    const skills: Skill[] = [];
    const bodies = new Map<string, string>();
    let skipped = 0;
    const skip = (why: string): void => {
      skipped++;
      this.warn(why);
    };

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(this.dir, { withFileTypes: true });
    } catch {
      /* missing skills dir = empty registry, not an error */
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirName = entry.name;
      const skillDir = path.join(this.dir, dirName);
      const skillMd = path.join(skillDir, "SKILL.md");

      // lstat, not stat: a symlinked SKILL.md could point anywhere — refuse
      // it before reading so the target never leaks into menu or warnings.
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(skillMd);
      } catch {
        continue; // a plain directory with no SKILL.md is not a skill — silent
      }
      if (!stat.isFile()) {
        skip(`${dirName}/SKILL.md is not a regular file (symlink?) — skipped`);
        continue;
      }

      let text: string;
      try {
        text = fs.readFileSync(skillMd, "utf8");
      } catch {
        skip(`${dirName}/SKILL.md is unreadable — skipped`);
        continue;
      }
      if (Buffer.byteLength(text) > SKILL_BODY_CAP_BYTES) {
        skip(`${dirName}/SKILL.md is over ${SKILL_BODY_CAP_BYTES} bytes — skipped (a skill body is a procedure, not a doc dump; move detail into reference files)`);
        continue;
      }

      const raw = parseFrontmatter(text);
      const parsed = SkillFrontmatter.safeParse(raw);
      if (raw === null || !parsed.success) {
        skip(`${dirName}/SKILL.md has no valid frontmatter (need name + description) — skipped`);
        continue;
      }
      if (parsed.data.name !== dirName) {
        skip(`${dirName}/SKILL.md declares name "${parsed.data.name}" but lives in "${dirName}" — skipped`);
        continue;
      }

      skills.push({ name: parsed.data.name, description: parsed.data.description, dir: skillDir });
      bodies.set(parsed.data.name, text);
    }

    skills.sort((a, b) => a.name.localeCompare(b.name));
    this.skills = skills;
    this.bodies = bodies;
    this.lastSkipped = skipped;
  }
}
