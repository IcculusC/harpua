/** One retrievable unit of a markdown document. Line numbers are 1-based,
 * inclusive, and true to the original file (frontmatter lines count). */
export interface MarkdownChunk {
  text: string;
  startLine: number;
  endLine: number;
  /** Headings above and including this chunk's section, outermost first. */
  headingTrail: string[];
}

const HEADING = /^(#{1,3})\s+(.+?)\s*$/;

interface Section {
  headingTrail: string[];
  /** [lineNumber, text] pairs for every line in the section. */
  lines: Array<[number, string]>;
}

/**
 * Heading-aware chunking for the knowledge index. Splits at h1–h3
 * boundaries; sections longer than `maxChunkChars` split further at blank
 * lines (never mid-paragraph). YAML frontmatter is excluded from text but
 * line numbering stays true so results point at the real file.
 */
export function chunkMarkdown(
  markdown: string,
  options: { maxChunkChars: number },
): MarkdownChunk[] {
  const lines = markdown.split("\n");

  // Skip frontmatter: a leading "---" line closed by the next "---" line.
  let start = 0;
  if (lines[0] === "---") {
    const close = lines.indexOf("---", 1);
    if (close !== -1) start = close + 1;
  }

  // Pass 1: group lines into heading-bounded sections with trails.
  const sections: Section[] = [];
  const trail: Array<string | undefined> = []; // index = heading level - 1
  let current: Section = { headingTrail: [], lines: [] };

  const flush = (): void => {
    if (current.lines.length > 0) sections.push(current);
  };

  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      trail[level - 1] = heading[2]!;
      trail.length = level; // deeper headings reset
      current = {
        headingTrail: trail.filter((h): h is string => h !== undefined),
        lines: [[i + 1, line]],
      };
    } else {
      current.lines.push([i + 1, line]);
    }
  }
  flush();

  // Pass 2: split oversized sections at blank-line (paragraph) boundaries.
  // A section's own heading line is NOT part of the chunk text (the trail
  // already carries it) but the first chunk's span still starts at the
  // heading line so read_lines shows it. Heading-only sections vanish.
  const chunks: MarkdownChunk[] = [];
  for (const section of sections) {
    const startsWithHeading =
      section.lines.length > 0 && HEADING.test(section.lines[0]![1]);
    const bodyLines = startsWithHeading ? section.lines.slice(1) : section.lines;
    if (bodyLines.length === 0) continue;

    const groups = splitByParagraphs(bodyLines, options.maxChunkChars);
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g]!;
      const text = group.map(([, line]) => line).join("\n").trim();
      if (text.length === 0) continue;
      chunks.push({
        text,
        startLine:
          g === 0 && startsWithHeading ? section.lines[0]![0] : group[0]![0],
        endLine: group[group.length - 1]![0],
        headingTrail: section.headingTrail,
      });
    }
  }
  return chunks;
}

/** Greedily pack paragraphs (blank-line separated runs) up to the cap. */
function splitByParagraphs(
  lines: Array<[number, string]>,
  maxChars: number,
): Array<Array<[number, string]>> {
  const totalChars = lines.reduce((sum, [, l]) => sum + l.length + 1, 0);
  if (totalChars <= maxChars) return [lines];

  // Break into paragraphs (blank lines attach to the preceding paragraph).
  const paragraphs: Array<Array<[number, string]>> = [];
  let paragraph: Array<[number, string]> = [];
  for (const entry of lines) {
    paragraph.push(entry);
    if (entry[1].trim() === "" && paragraph.some(([, l]) => l.trim() !== "")) {
      paragraphs.push(paragraph);
      paragraph = [];
    }
  }
  if (paragraph.length > 0) paragraphs.push(paragraph);

  const groups: Array<Array<[number, string]>> = [];
  let group: Array<[number, string]> = [];
  let groupChars = 0;
  for (const p of paragraphs) {
    const pChars = p.reduce((sum, [, l]) => sum + l.length + 1, 0);
    if (group.length > 0 && groupChars + pChars > maxChars) {
      groups.push(group);
      group = [];
      groupChars = 0;
    }
    group.push(...p); // a single over-cap paragraph stays whole
    groupChars += pChars;
  }
  if (group.length > 0) groups.push(group);
  return groups;
}
