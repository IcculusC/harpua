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

/**
 * The payload `askUserTool` hands the client via `interrupt()` — the ask_user
 * sibling of `ToolApprovalRequest` (`graph-tools.ts`), discriminated the same
 * way (on `type`). `questions` is `unknown[]` at the schema level because the
 * runtime payload is built AFTER the caller's own `Q` has already been
 * validated by the envelope schema; {@link AskUserRequest} carries the real
 * `Q` for TypeScript consumers.
 */
export const askUserRequestSchema = z.object({
  type: z.literal("ask_user_request"),
  intro: z.string().optional(),
  questions: z.array(z.unknown()),
});

/** Exported type for clients: the payload `askUserTool` interrupts with. */
export type AskUserRequest<Q = unknown> = {
  type: "ask_user_request";
  intro?: string;
  questions: Q[];
};

/** One positional answer slot; `null` means the host recorded no answer for that question. */
const askUserAnswerValueSchema = z.union([
  z.string(),
  z.array(z.string()),
  z.boolean(),
  z.null(),
]);

/** Resume value: positional answers, index-aligned to the paused `questions`. */
export const askUserAnswersResumeSchema = z.object({
  answers: z.array(askUserAnswerValueSchema),
});

/** Resume value: the host dismissed the questions instead of answering them. */
export const askUserDismissedResumeSchema = z.object({
  dismissed: z.literal(true),
  reason: z.string().optional(),
});

/** Either shape a host may resume an `ask_user` interrupt with. */
export const askUserResumeSchema = z.union([
  askUserAnswersResumeSchema,
  askUserDismissedResumeSchema,
]);

export type AskUserAnswerValue = z.infer<typeof askUserAnswerValueSchema>;
export type AskUserAnswersResume = z.infer<typeof askUserAnswersResumeSchema>;
export type AskUserDismissedResume = z.infer<typeof askUserDismissedResumeSchema>;
export type AskUserResume = z.infer<typeof askUserResumeSchema>;

/**
 * Zod-validates a resume value against the number of paused questions.
 * Mirrors `resolveDecision` in `graph-tools.ts`: an unknown shape throws a
 * clear, actionable error naming the tool and the expected shape — never
 * silently treated as an answer. An `answers` array whose length doesn't
 * match `questionCount` throws too — silent misalignment (answer 2 read as
 * the answer to question 3) is the worst failure mode. A dismissal has no
 * length to check and always passes through once its shape validates.
 */
export function resolveAskUserResume(
  toolName: string,
  questionCount: number,
  resume: unknown,
): AskUserResume {
  const parsed = askUserResumeSchema.safeParse(resume);
  if (!parsed.success) {
    throw new Error(
      `Invalid resume value for ask_user tool '${toolName}': expected ` +
        "{ answers: Array<string | string[] | boolean | null> } or " +
        `{ dismissed: true, reason?: string }, received ${JSON.stringify(resume)}.`,
    );
  }
  if ("dismissed" in parsed.data) {
    return parsed.data;
  }
  if (parsed.data.answers.length !== questionCount) {
    throw new Error(
      `Invalid resume value for ask_user tool '${toolName}': expected ` +
        `${questionCount} answer(s) (one per question), received ` +
        `${parsed.data.answers.length}.`,
    );
  }
  return parsed.data;
}
