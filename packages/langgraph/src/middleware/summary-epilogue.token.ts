/**
 * Carries `strategy.epilogue` from the compaction providers to the summary
 * renderer WITHOUT either middleware importing the other.
 *
 * This file must never import anything. `compaction.middleware.ts` already
 * imports `ContextWindowMiddleware`; if the window side imported compaction's
 * options back, the pair would become mutually dependent. A dependency-free
 * leaf both sides may import is the cycle break.
 */
export const SUMMARY_EPILOGUE = Symbol.for("@harpua/langgraph:SUMMARY_EPILOGUE");
