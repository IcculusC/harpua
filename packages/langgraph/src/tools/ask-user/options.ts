import { z, type ZodType } from "zod";

import { DEFAULT_MAX_QUESTIONS } from "./schemas";
import type { AskUserAnswerValue, AskUserQuestionPreset } from "./schemas";

/** Default tool name the model sees. */
export const DEFAULT_ASK_USER_NAME = "ask_user";

/** Default tool description: hammers batching every question into ONE call. */
export const DEFAULT_ASK_USER_DESCRIPTION =
  "Ask the user one or more questions and wait for their answers before " +
  "continuing. BATCH EVERYTHING YOU NEED INTO ONE CALL: put every question " +
  "the user must answer before you can proceed into the SAME `questions` " +
  "array — never call this tool a second time in the same turn just to ask " +
  "one more question. Each question needs a `prompt`; the default " +
  "vocabulary also takes an `inputType` (`select`, `multi_select`, " +
  "`boolean`, or `free_text`) and, for `select`/`multi_select`, an " +
  "`options` list of choices.";

/** Default text returned to the model when the host dismisses the questions. */
export const DEFAULT_DISMISSED_MESSAGE =
  "(user dismissed the questions — proceed with your best judgment and " +
  "record any assumptions)";

/**
 * Options for {@link askUserTool}. `Q` is the question shape the model
 * fills — the default preset ({@link AskUserQuestionPreset}) unless
 * `questionSchema` overrides it. The `Q extends { prompt: string }` bound
 * guarantees the default serializer can always render a `prompt: answer`
 * line, even for a fully custom vocabulary.
 */
export interface AskUserToolOptions<
  Q extends { prompt: string } = AskUserQuestionPreset,
> {
  /** Tool name the model sees. Default {@link DEFAULT_ASK_USER_NAME}. */
  name?: string;
  /** Tool description the model sees. Default {@link DEFAULT_ASK_USER_DESCRIPTION}. */
  description?: string;
  /** Cap on `questions.length`. Default {@link DEFAULT_MAX_QUESTIONS} (8). */
  maxQuestions?: number;
  /** Custom question vocabulary; defaults to the flat select/multi_select/boolean/free_text preset. */
  questionSchema?: z.ZodType<Q>;
  /** Custom serializer; defaults to `defaultSerializeAnswers`. */
  serializeAnswers?: (questions: Q[], answers: AskUserAnswerValue[]) => string;
  /** Text returned to the model when the host dismisses instead of answering. Default {@link DEFAULT_DISMISSED_MESSAGE}. */
  dismissedMessage?: string;
}

const questionSchemaFieldSchema = z.custom<ZodType>(
  (v) => v instanceof z.ZodType,
  "questionSchema must be a zod schema",
);

const serializeAnswersFieldSchema = z.custom<(...args: any[]) => string>(
  (v) => typeof v === "function",
  "serializeAnswers must be a function (questions, answers) => string",
);

/**
 * Runtime shape-check companion to {@link AskUserToolOptions} — the same
 * throw-safe, `z.custom`-for-functions idiom `requireApprovalOptionsSchema`
 * uses in `graph-tools.ts` (and `StrategySchema` uses in
 * `compaction.options.ts` for a zod-schema-valued field). Strict: unknown
 * keys throw.
 */
export const askUserToolOptionsSchema = z
  .object({
    name: z.string().min(1).default(DEFAULT_ASK_USER_NAME),
    description: z.string().min(1).default(DEFAULT_ASK_USER_DESCRIPTION),
    maxQuestions: z.number().int().positive().default(DEFAULT_MAX_QUESTIONS),
    questionSchema: questionSchemaFieldSchema.optional(),
    serializeAnswers: serializeAnswersFieldSchema.optional(),
    dismissedMessage: z.string().min(1).default(DEFAULT_DISMISSED_MESSAGE),
  })
  .strict();

/** Fully-resolved options with all defaults applied. */
export type ResolvedAskUserToolOptions = z.infer<typeof askUserToolOptionsSchema>;

/** Parse + default `askUserTool` options, throwing on an invalid shape. */
export function resolveAskUserToolOptions<Q extends { prompt: string }>(
  options: AskUserToolOptions<Q> = {},
): ResolvedAskUserToolOptions {
  return askUserToolOptionsSchema.parse(options);
}
