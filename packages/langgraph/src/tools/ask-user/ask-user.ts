import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { interrupt } from "@langchain/langgraph";
import type { z } from "zod";

import {
  askUserQuestionPresetSchema,
  askUserRequestSchema,
  buildAskUserEnvelopeSchema,
  normalizeAskUserPreset,
  resolveAskUserResume,
  type AskUserAnswerValue,
  type AskUserQuestionPreset,
} from "./schemas";
import { resolveAskUserToolOptions, type AskUserToolOptions } from "./options";
import { defaultSerializeAnswers } from "./serialize-answers";

/**
 * `askUserTool(options?)` — the model-callable sibling of the approval gate
 * (`requireApproval` / `@LangGraphTool({ requiresApproval: true })`): instead
 * of gating a tool's EXECUTION, the model calls `ask_user` directly with
 * typed questions, the host renders them, and the answers return as the tool
 * result mid-turn. See
 * `docs/superpowers/specs/2026-07-15-ask-user-tool-design.md`.
 *
 * Flow: strict envelope validation (this IS the tool's own call schema, so a
 * malformed call never reaches the code below) → preset normalization
 * (default vocabulary only) → `interrupt({ type: "ask_user_request", intro?,
 * questions })` → the host resumes with `{ answers }` (index-aligned to
 * `questions`) or `{ dismissed: true, reason? }` → the resume is zod-validated
 * (see `resolveAskUserResume`) → serialize → the string returns as the tool
 * result.
 *
 * No try/catch around `interrupt()` — its `GraphInterrupt` throw must
 * propagate unmodified so LangGraph can pause the run (pinned behavior; see
 * `tool-interrupt-proof.spec.ts`). A throwing custom `serializeAnswers` is
 * likewise never caught — its return IS the tool result, so there is nothing
 * safe to degrade to.
 */
export function askUserTool<
  Q extends { prompt: string } = AskUserQuestionPreset,
>(options?: AskUserToolOptions<Q>): StructuredToolInterface {
  const opts = resolveAskUserToolOptions(options);
  const isDefaultPreset = opts.questionSchema === undefined;
  const questionSchema = (opts.questionSchema ??
    askUserQuestionPresetSchema) as z.ZodType<Q>;
  const envelopeSchema = buildAskUserEnvelopeSchema(questionSchema, opts.maxQuestions);
  const serialize = (opts.serializeAnswers ?? defaultSerializeAnswers) as (
    questions: Q[],
    answers: AskUserAnswerValue[],
  ) => string;

  return tool(
    (input: { intro?: string; questions: Q[] }) => {
      const questions = isDefaultPreset
        ? ((input.questions as unknown as AskUserQuestionPreset[]).map(
            normalizeAskUserPreset,
          ) as unknown as Q[])
        : input.questions;

      const resume = interrupt(
        askUserRequestSchema.parse({
          type: "ask_user_request",
          ...(input.intro !== undefined ? { intro: input.intro } : {}),
          questions,
        }),
      );

      const decision = resolveAskUserResume(opts.name, questions.length, resume);
      return "dismissed" in decision
        ? opts.dismissedMessage
        : serialize(questions, decision.answers);
    },
    {
      name: opts.name,
      description: opts.description,
      schema: envelopeSchema,
    },
  );
}
