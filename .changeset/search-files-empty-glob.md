---
"@harpua/agent-tools": patch
---

`search_files` no longer reports `"No matches."` when it searched nothing at all. ripgrep exits `1` both when it searched files and found nothing *and* when it searched no file whatsoever — and the second is not evidence of anything. The tool collapsed those into one string, telling agents a pattern was absent from files it had never opened.

An empty search now establishes **why** it was empty before answering, and names the mechanism responsible — because the remedies are opposites, and a wrong guess sends an agent hunting for a glob that cannot exist or abandoning a file it could simply have read:

- **Files were searched** → `"No matches."`, unchanged and true.
- **The glob matched nothing** → says nothing was searched, and notes that a bare directory name (`src`) matches no files where `src/**` works.
- **The files are hidden** → `search_files` never searches dotfiles (`.github/`, `.env`, `.vscode/`), which it now also states in its description. Points at `read_lines`, which reads them fine.
- **The files are excluded by an ignore rule** → names ignore rules rather than blaming the glob, and notes the rule may live in a parent directory or global git config rather than in the project at all.
- **Both at once** (`.env` listed in `.gitignore`; `.venv/`, `.next/`, `.turbo/`) → names both, since no glob can reach them.
- **The files are inside `.git/`** → says so, rather than blaming a glob that was correct.
- **A probe itself fails** → falls back to `"No matches."` and invents no cause.

Every case where the files exist now points at `read_lines`, which applies no ignore-rule or dotfile filter — so the agent is never dead-ended on a file it could have read.

The diagnosis runs only on a search that already came back empty, and costs at most a few `rg --files --quiet` probes, which print nothing and exit at the first file found.
