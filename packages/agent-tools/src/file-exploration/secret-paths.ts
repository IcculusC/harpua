/**
 * A denylist of paths whose *contents* are almost always credentials, matched
 * against a path RELATIVE to the sandbox root. The file tools that read by path
 * (`read_lines`, `file_stats`) refuse anything this matches, so an injected
 * agent cannot exfiltrate `.env` and friends by naming them directly.
 *
 * This is a targeted secret list, NOT a blanket dotfile ban: `.github/`,
 * `.vscode/`, `.eslintrc` and other non-secret dotfiles stay readable. The two
 * mechanisms are complementary — `search_files` refuses *all* hidden files
 * (a search over secrets is never wanted); these path readers refuse only the
 * known-secret subset (reading a CI workflow is legitimate).
 *
 * CRITICAL: match on the path the sandbox has already REALPATH'd, never the
 * caller's input. A symlink `notes.txt -> .env` resolves to the real `.env`
 * before this runs, so a harmless-looking name cannot smuggle a secret past the
 * list. See `Sandbox.resolve`.
 */

/**
 * Default secret patterns, tested (case-insensitively) against the root-relative
 * POSIX path. Two shapes appear:
 *   - `(^|/)NAME$`     — a secret basename at any depth (e.g. `.env`, `id_rsa`).
 *   - `(^|/)DIR/`      — anything inside a secret directory (e.g. `.ssh/…`).
 * Anchored on `/` boundaries so `environment.ts` does not match `.env` and
 * `id_rsad` does not match `id_rsa`.
 */
export const DEFAULT_SECRET_PATTERNS: readonly RegExp[] = [
  // dotenv files, including .env.local / .env.production — but NOT the
  // .example/.sample/.template variants, which are placeholder-only, meant to be
  // committed and read, and hold no secret. The negative lookahead exempts them.
  /(^|\/)\.env(\.(?!example$|sample$|template$)[^/]*)?$/i,
  // credential dirs — block the dir itself AND everything beneath it, so neither
  // its contents nor its filename listing is reachable
  /(^|\/)\.ssh(\/|$)/i,
  /(^|\/)\.aws(\/|$)/i,
  /(^|\/)\.gnupg(\/|$)/i,
  /(^|\/)\.kube(\/|$)/i,
  /(^|\/)\.docker(\/|$)/i,
  // single-file credential stores
  /(^|\/)\.netrc$/i,
  /(^|\/)\.pgpass$/i,
  /(^|\/)\.git-credentials$/i,
  /(^|\/)\.htpasswd$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.pypirc$/i,
  /(^|\/)credentials(\.json)?$/i,
  // private key material by conventional name…
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i,
  // …and by extension
  /\.(pem|key|p12|pfx)$/i,
];

/**
 * True when `relPath` (a path relative to the sandbox root) matches any pattern
 * in `patterns`. `relPath` is normalized to forward slashes first, so a
 * backslash separator cannot dodge a `/`-anchored rule. An empty pattern list
 * matches nothing.
 */
export function isSecretPath(relPath: string, patterns: readonly RegExp[]): boolean {
  const posix = relPath.replace(/\\/g, "/");
  return patterns.some((re) => re.test(posix));
}
