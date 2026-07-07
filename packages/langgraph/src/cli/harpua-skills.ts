#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";

import { z } from "zod";

/**
 * `harpua-skills` — wires the agent skills shipped by installed `@harpua/*`
 * packages into a consuming project's agent skill directories so both Claude
 * Code (`.claude/skills`) and Codex (`.agents/skills`) discover them.
 *
 * Run from the consumer project root, typically via a `prepare` script.
 */

/** Agent skill directories both supported tools scan, relative to the project root. */
const AGENT_DIRS = [".claude/skills", ".agents/skills"] as const;

/**
 * A skill directory name must be a single, safe path segment — it becomes the
 * link basename. Validated (not hand-rolled) so a malformed `node_modules`
 * entry can never produce a link outside the intended agent dir.
 */
const skillNameSchema = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9._-]+$/)
  .refine((name) => name !== "." && name !== "..");

export type LinkAction = "created" | "skipped" | "replaced" | "warned";

export interface LinkOutcome {
  /** Skill (directory) name. */
  skill: string;
  /** Which agent directory this outcome is for, e.g. ".claude/skills". */
  agentDir: string;
  /** Absolute path of the link that was (or would have been) written. */
  linkPath: string;
  action: LinkAction;
  /** Human-readable reason, present for `replaced` and `warned`. */
  reason?: string;
}

export interface LinkSkillsResult {
  /** Distinct skill names discovered under installed `@harpua/*` packages. */
  skills: string[];
  outcomes: LinkOutcome[];
  /** Count of skills that ended up with at least one live link. */
  linkedCount: number;
  /** Warning lines (real path collisions) for stderr. */
  warnings: string[];
  /** Per-skill lines to print (replacements + warnings); empty on a clean idempotent run. */
  messages: string[];
  /** Single summary line for stdout. */
  summary: string;
}

export interface LinkSkillsOptions {
  /** Consumer project root (defaults handled by the caller). */
  cwd: string;
  /** Override for tests; defaults to the running platform. */
  platform?: NodeJS.Platform;
}

interface DiscoveredSkill {
  name: string;
  /** Absolute path to the skill directory inside node_modules. */
  targetDir: string;
}

/**
 * Scan `node_modules/@harpua/<pkg>/skills/<skill>/SKILL.md`. Every such
 * directory containing a SKILL.md is a linkable skill. The package name is not
 * hardcoded — any installed `@harpua` package may ship skills.
 */
function discoverSkills(cwd: string): DiscoveredSkill[] {
  const scope = path.join(cwd, "node_modules", "@harpua");
  const packages = readdirOrEmpty(scope);

  const discovered: DiscoveredSkill[] = [];
  const seen = new Set<string>();
  for (const pkg of packages) {
    const skillsDir = path.join(scope, pkg, "skills");
    for (const entry of fs.existsSync(skillsDir)
      ? fs.readdirSync(skillsDir, { withFileTypes: true })
      : []) {
      // Follow into real dirs or symlinked skill dirs alike.
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const parsed = skillNameSchema.safeParse(entry.name);
      if (!parsed.success) continue;
      const targetDir = path.join(skillsDir, entry.name);
      if (!fs.existsSync(path.join(targetDir, "SKILL.md"))) continue;
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      discovered.push({ name: entry.name, targetDir });
    }
  }
  return discovered;
}

/**
 * `fs.readdirSync` that yields `[]` when the directory is absent (a project
 * with no `@harpua` deps at all), while surfacing genuine errors (permissions)
 * as discovery failures.
 */
function readdirOrEmpty(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** Ensure a single skill is linked into a single agent dir, idempotently. */
function ensureLink(
  cwd: string,
  agentDir: string,
  skill: DiscoveredSkill,
  platform: NodeJS.Platform,
): LinkOutcome {
  const linkPath = path.join(cwd, agentDir, skill.name);
  const base = { skill: skill.name, agentDir, linkPath };

  let stat: fs.Stats | undefined;
  try {
    stat = fs.lstatSync(linkPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  if (stat && !stat.isSymbolicLink()) {
    // Real user-owned directory or file — never clobber.
    return {
      ...base,
      action: "warned",
      reason: `${agentDir}/${skill.name} exists as a real ${stat.isDirectory() ? "directory" : "file"}; leaving it untouched`,
    };
  }

  if (stat) {
    // Existing symlink: keep it if already correct, otherwise replace.
    const current = path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
    if (current === path.resolve(skill.targetDir)) {
      return { ...base, action: "skipped" };
    }
    // unlinkSync always removes the link itself (rmSync can chase a broken
    // symlink's missing target).
    fs.unlinkSync(linkPath);
    writeLink(linkPath, skill.targetDir, platform);
    return {
      ...base,
      action: "replaced",
      reason: `${agentDir}/${skill.name} pointed elsewhere; replaced with the current @harpua target`,
    };
  }

  writeLink(linkPath, skill.targetDir, platform);
  return { ...base, action: "created" };
}

/**
 * Create the link. POSIX gets a RELATIVE symlink target (portable when the
 * project moves); win32 gets a directory junction, which requires an ABSOLUTE
 * target.
 */
function writeLink(linkPath: string, targetDir: string, platform: NodeJS.Platform): void {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  if (platform === "win32") {
    fs.symlinkSync(path.resolve(targetDir), linkPath, "junction");
    return;
  }
  const relative = path.relative(path.dirname(linkPath), targetDir);
  fs.symlinkSync(relative, linkPath, "dir");
}

export function linkSkills(options: LinkSkillsOptions): LinkSkillsResult {
  const { cwd } = options;
  const platform = options.platform ?? process.platform;

  const skills = discoverSkills(cwd);

  if (skills.length === 0) {
    return {
      skills: [],
      outcomes: [],
      linkedCount: 0,
      warnings: [],
      messages: [],
      summary: "harpua-skills: no @harpua skills found to link (nothing to do)",
    };
  }

  const outcomes: LinkOutcome[] = [];
  for (const skill of skills) {
    for (const agentDir of AGENT_DIRS) {
      outcomes.push(ensureLink(cwd, agentDir, skill, platform));
    }
  }

  const warnings = outcomes
    .filter((o) => o.action === "warned")
    .map((o) => `harpua-skills: WARNING ${o.reason}`);
  const replacements = outcomes
    .filter((o) => o.action === "replaced")
    .map((o) => `harpua-skills: ${o.reason}`);

  // A skill counts as linked if at least one agent dir now holds a live link.
  const linkedNames = [
    ...new Set(
      outcomes
        .filter((o) => o.action !== "warned")
        .map((o) => o.skill),
    ),
  ];
  const linkedCount = linkedNames.length;

  const noun = linkedCount === 1 ? "skill" : "skills";
  const summary =
    linkedCount > 0
      ? `harpua-skills: linked ${linkedCount} ${noun} into ${AGENT_DIRS[0]} and ${AGENT_DIRS[1]} (${linkedNames.sort().join(", ")})`
      : `harpua-skills: found ${skills.length} skill(s) but all agent paths are user-owned; nothing linked`;

  return {
    skills: skills.map((s) => s.name),
    outcomes,
    linkedCount,
    warnings,
    messages: [...replacements, ...warnings],
    summary,
  };
}

/* istanbul ignore next -- bin entry: thin caller, exercised by the pack smoke test */
function main(): void {
  let result: LinkSkillsResult;
  try {
    result = linkSkills({ cwd: process.cwd() });
  } catch (err) {
    // Discovery failed (e.g. unreadable node_modules). Surface and fail.
    console.error(`harpua-skills: failed to link skills: ${(err as Error).message}`);
    process.exit(1);
  }
  for (const line of result.messages) console.error(line);
  console.log(result.summary);
}

/* istanbul ignore next -- only runs as a bin, not when imported by tests */
if (require.main === module) {
  main();
}
