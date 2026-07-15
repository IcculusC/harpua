import { z } from "zod";

/** Ceiling `questions` is capped at when a caller doesn't override `maxQuestions`. */
export const DEFAULT_MAX_QUESTIONS = 8;

/**
 * The default question vocabulary the model fills when `askUserTool` is given
 * no custom `questionSchema`. Flat by design — providers fumble nested unions
 * on tool schemas — so every field is a plain string/enum/array, never a
 * discriminated union. `options` is meaningful only for `select`/`multi_select`;
 * see {@link normalizeAskUserPreset} for how it's cleaned up before use.
 */
export const askUserQuestionPresetSchema = z
  .object({
    prompt: z.string().min(1).describe("The question text shown to the user."),
    inputType: z
      .enum(["select", "multi_select", "boolean", "free_text"])
      .describe(
        "How the user answers: 'select' (one of options), 'multi_select' " +
          "(any of options), 'boolean' (yes/no), or 'free_text' (open-ended).",
      ),
    options: z
      .array(z.string())
      .optional()
      .describe(
        "Choices for 'select'/'multi_select'; ignored for other inputTypes.",
      ),
  })
  .strict();

/** The default preset question shape (`z.infer` — no hand-written duplicate). */
export type AskUserQuestionPreset = z.infer<typeof askUserQuestionPresetSchema>;

/**
 * Normalizes one preset question's `options` (default vocabulary ONLY — a
 * custom `questionSchema` brings its own normalization, or none):
 *
 * 1. Trim each option.
 * 2. Drop empties (post-trim).
 * 3. Dedupe (first occurrence wins).
 * 4. For `select`/`multi_select`: if fewer than 2 options survive, coerce the
 *    question to `free_text` (dropping `options`) — a select/multi_select
 *    widget with 0 or 1 choices is never rendered; a free-text prompt always
 *    is.
 *
 * `boolean`/`free_text` questions pass through unchanged.
 */
export function normalizeAskUserPreset(
  question: AskUserQuestionPreset,
): AskUserQuestionPreset {
  if (question.inputType !== "select" && question.inputType !== "multi_select") {
    return question;
  }
  const seen = new Set<string>();
  const survivors: string[] = [];
  for (const raw of question.options ?? []) {
    const trimmed = raw.trim();
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    survivors.push(trimmed);
  }
  if (survivors.length < 2) {
    return { prompt: question.prompt, inputType: "free_text" };
  }
  return {
    prompt: question.prompt,
    inputType: question.inputType,
    options: survivors,
  };
}

/**
 * Builds the envelope schema `{ intro?, questions }` for a given question
 * schema `Q`, with `questions` capped at `maxQuestions`. Strict: unknown
 * top-level keys throw. This IS the tool's own call schema — `tool(...)`
 * (from `@langchain/core/tools`) validates the model's args against it before
 * the handler ever runs, so a malformed call never reaches `interrupt()`.
 */
export function buildAskUserEnvelopeSchema<Q extends z.ZodTypeAny>(
  questionSchema: Q,
  maxQuestions: number,
) {
  return z
    .object({
      intro: z.string().optional(),
      questions: z.array(questionSchema).min(1).max(maxQuestions),
    })
    .strict();
}
