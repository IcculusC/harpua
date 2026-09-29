import type { UnpdfModuleLike } from "./options.js";

/**
 * Lazily import `unpdf` (an optional peer). `fetch_pdf` injects this by
 * default; tests override it to exercise the missing-package path
 * deterministically. Returns the module narrowed to the {@link UnpdfModuleLike}
 * surface `fetch_pdf` actually uses.
 */
export function loadUnpdf(): Promise<UnpdfModuleLike> {
  return import("unpdf") as Promise<UnpdfModuleLike>;
}
