import type { BaseMessage } from "@langchain/core/messages";

/** additional_kwargs key marking a provider-agnostic cache boundary. */
export const CACHE_BOUNDARY = "__harpua_cache_boundary";

/** Mark a message as the end of a stable cache region. */
export function markCacheBoundary(m: BaseMessage): void {
  (m.additional_kwargs as Record<string, unknown>)[CACHE_BOUNDARY] = true;
}

/**
 * Translate abstract boundary markers for the running provider. Anthropic needs
 * an explicit `cache_control` block; every other provider caches automatically
 * off a stable prefix, so the marker is stripped. Best-effort: an unknown
 * llmType strips (safe no-op).
 */
export function translateCacheMarkers(messages: BaseMessage[], llmType: string): BaseMessage[] {
  return messages.map((m) => {
    const kwargs = m.additional_kwargs as Record<string, unknown>;
    if (!kwargs?.[CACHE_BOUNDARY]) return m;
    const { [CACHE_BOUNDARY]: _flag, ...rest } = kwargs;
    if (llmType === "anthropic") {
      m.additional_kwargs = { ...rest, cache_control: { type: "ephemeral" } };
    } else {
      m.additional_kwargs = rest;
    }
    return m;
  });
}
