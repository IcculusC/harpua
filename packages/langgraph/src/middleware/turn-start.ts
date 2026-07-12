import {
  isHumanMessage,
  isSystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";

/**
 * True when the last non-`SystemMessage` message is a `HumanMessage` — i.e.
 * this model call is still the start of a user turn.
 *
 * Gate a turn-start `wrapModelCall` middleware on THIS, never on "the last
 * message is a `HumanMessage`": composed `wrapModelCall` middlewares each
 * receive the request as already mutated by the middlewares outside them, so
 * an outer sibling that appended a `SystemMessage` trailer hides the human
 * turn from a literal-tail check and the inner middleware silently never
 * fires.
 */
export function lastNonSystemIsHuman(messages: readonly BaseMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (isSystemMessage(m)) continue;
    return isHumanMessage(m);
  }
  return false;
}
