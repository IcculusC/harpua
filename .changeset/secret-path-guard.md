---
"@harpua/agent-tools": minor
---

**`read_lines` and `file_stats` now refuse to open known-secret paths.** Previously `read_lines({ path: ".env" })` returned the file's contents — so hardening `search_files` against hidden-file reads (the sibling change) did not actually keep an injected agent away from secrets; it just closed one of several doors. This closes the path-reader door.

The guard runs inside the sandbox's path resolution, on the **realpath'd** path — *after* symlinks and `..` are collapsed — so a harmless-looking name (`notes.txt` → `.env`), a symlinked secret directory, a multi-hop symlink chain, or a normalizing traversal (`src/../.env`) all resolve to the real secret and are refused. The refusal names no alternative tool, so it can't double as a how-to.

It is a **targeted** credential denylist, not a blanket dotfile ban: `.env` (and `.env.local`, `.env.production`, …), `.ssh/`, `.aws/`, `.gnupg/`, `.kube/`, `.docker/`, `.netrc`, `.pgpass`, `.git-credentials`, `.htpasswd`, `.npmrc`, `.pypirc`, `credentials`/`credentials.json`, `id_rsa`/`id_dsa`/`id_ecdsa`/`id_ed25519`, and `*.pem`/`*.key`/`*.p12`/`*.pfx`. Non-secret dotfiles (`.github/`, `.vscode/`, `.eslintrc`) stay readable, as do the placeholder `.env.example`/`.env.sample`/`.env.template` templates and public keys (`id_rsa.pub`).

Configurable via the new `blockedSecretPatterns` option (an array of `RegExp` matched against the root-relative POSIX path): extend it with project-specific secrets, replace it, or pass `[]` to disable. Exports `DEFAULT_SECRET_PATTERNS` and `isSecretPath`.

**Known limits.** The guard blocks reading secret *contents*, not the appearance of a non-hidden secret *filename* in a `file_stats` directory listing (e.g. `server.pem` still shows as a name with its size; opening it is refused). And a hardlink to a secret under a non-secret name is not caught — `realpath` cannot distinguish a hardlink from the real file, so this is inherent to any path-based guard, and creating one requires filesystem write access these read-only tools never grant. Symlinks, `..` traversal, and a directory literally named `.env` *are* all covered, because the check runs on the realpath'd, root-relative path.
