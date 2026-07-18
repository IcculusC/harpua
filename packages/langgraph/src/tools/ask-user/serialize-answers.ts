import type { AskUserAnswerValue } from "./schemas";

/**
 * The minimum shape the default serializer needs from a question — every
 * preset AND every custom `questionSchema` satisfies this (enforced by
 * `askUserTool`'s `Q extends { prompt: string }` bound).
 */
export interface SerializableAskUserQuestion {
  prompt: string;
}

/** Renders one positional answer the way the default serializer's lines read it. */
function renderAskUserAnswer(value: AskUserAnswerValue | undefined): string {
  if (value === null || value === undefined) return "(no answer)";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

/**
 * The default `serializeAnswers`: one `prompt: answer` line per question, in
 * order. `answers` is index-aligned to `questions` — guaranteed by
 * `resolveAskUserResume`'s length check, which always runs before this.
 * `string[]` answers join with `", "`; booleans render `yes`/`no`; `null`
 * (a skipped question) renders `(no answer)`.
 */
export function defaultSerializeAnswers<Q extends SerializableAskUserQuestion>(
  questions: Q[],
  answers: AskUserAnswerValue[],
): string {
  return questions
    .map(
      (question, index) => `${question.prompt}: ${renderAskUserAnswer(answers[index])}`,
    )
    .join("\n");
}
