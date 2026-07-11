---
"@harpua/agent-tools": minor
---

**`search_files` no longer reads hidden files, even when a glob names them.** Ripgrep skips dotfiles by default, but a positive `--glob` is a *whitelist* that overrides that default **and** ignore rules — so `search_files(pattern, glob: ".env")` (and `*.env`, and any other glob naming it) read `.env` straight out, `.gitignore` notwithstanding. The protection was an accident of the default, and any agent that named the file defeated it. Hidden files are now excluded unconditionally: no glob overrides it.

This is a **behavior change**: a caller who relied on an explicit glob to reach a dotfile will no longer get one.

**Scope:** this closes `search_files` as a *search-based* path to hidden-file contents. It does **not** make dotfiles unreadable across the toolkit — `read_lines` and `file_stats` still read and list them by design. If your threat model is "no agent may read `.env`", hardening `search_files` alone is not sufficient; that is a separate, deliberate decision about the file tools as a whole.

**`search_files` also no longer reports `"No matches."` when it searched nothing at all.** Ripgrep exits `1` both when it searched files and found nothing *and* when it searched no file whatsoever — and the second is not evidence of anything. The tool collapsed those into one string, telling agents a pattern was absent from files it had never opened. In production this cost ~11 model calls in a single turn: the agent disbelieved its own earlier `read_file` output and re-read the target file in six widening windows, hunting for lines the tool had just told it did not exist.

An empty search now establishes **why** it was empty before answering, and names the mechanism — the remedies are opposites, and a wrong guess sends an agent hunting for a glob that cannot exist, or abandoning a file it could simply have read:

- **Files were searched** → `"No matches."`, unchanged and true.
- **The glob matched nothing** → says nothing was searched, and notes that a bare directory name (`src`) matches no files where `src/**` works.
- **The files are hidden** → states that hidden files are never searched and that this is deliberate. Offers no bypass.
- **Excluded by an ignore rule** → names ignore rules rather than blaming the glob, notes the rule may live in a parent directory or global git config rather than in the project, and points at `read_lines`.
- **Both at once** (`.env` in `.gitignore`; `.venv/`, `.next/`, `.turbo/`) → names both.
- **The glob spans both** (one match hidden, another ignored) → says so, rather than claiming *every* match is hidden and silently never mentioning the ignored file.
- **Inside `.git/`** → says so, rather than blaming a glob that was correct.
- **A probe itself fails** → falls back to `"No matches."` and invents no cause.

Diagnosis runs only on a search that already came back empty, and costs at most a few `rg --files --quiet` probes, which print nothing and exit at the first file found.

`search_files`' description now states outright that hidden files are not searched.
