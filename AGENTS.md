# Working on bruv

- Read the module you change and the notes in `.agents/notes/` that touch it. `rewrite.md` there
  describes how bruv 1.0 was built; where it and the code disagree, the code wins, so fix the note.
- Keep modules small. Split one when it gets hard to read in one go.
- Keep the team's notes in `.agents/notes/`: choices and why, what was tried, where work stopped. Use `.tmp/` for scratch files.
- Follow the test rules in `rewrite.md` section 3.14. Do not assert wording.
- Use plain, short English. Prefer the common word to jargon.
- bruv builds on Pi; it never forks it. Never change Pi's files. If Pi lacks a hook, see
  `.agents/notes/values.md` for when and how bruv may change the running Pi.
- Use one imperative line for commit messages, with an optional short body.
- Before committing: `bunx biome ci . && bun run check && bun test && bun run test:site`. `site/` is a Bun workspace; its browser checks are in `site/README.md`.
