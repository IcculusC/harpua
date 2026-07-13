/**
 * C0/C1 control characters except `\t` (0x09) and `\n` (0x0A). Scraped PDFs
 * routinely carry 0x01-0x05/0x0E; those bytes are pure embedding noise and
 * have broken the postgres wire protocol on insert.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

/**
 * Default `ingest` sanitizer: strip C0/C1 control characters, keeping only
 * `\t` and `\n` (so tables and paragraph structure survive). Applied to each
 * chunk's text before the junk floor, embedding, and storage.
 */
export function stripControlChars(text: string): string {
  return text.replace(CONTROL_CHARS, "");
}
