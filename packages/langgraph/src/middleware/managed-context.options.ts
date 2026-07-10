import { z } from "zod";
import { CompactionOptions } from "./compaction.options";
import { ContextWindowOptions } from "./context-window.options";

export const MANAGED_CONTEXT_OPTS = Symbol.for("@harpua/langgraph:MANAGED_CONTEXT_OPTS");

// Merge both option shapes into one surface (context-window fields are all optional/defaulted).
export const ManagedContextOptions = CompactionOptions.merge(ContextWindowOptions);
export type ManagedContextOptions = z.infer<typeof ManagedContextOptions>;
