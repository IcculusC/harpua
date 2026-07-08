---
"create-harpua-app": patch
---

Template `start` and `chat` scripts now load `.env` automatically via node's
`--env-file-if-exists` (the README already told users to copy `.env.example`,
but no script actually read it). `start:dev` can't take node flags through
`nest start --watch`, so the README documents exporting variables instead.
Also keeps stray local `template/dist` build artifacts out of the published
tarball.
