# Working on bruv

- Read `.agents/notes/rewrite.md` (until merged) and the module you change.
- Follow the module line budgets in section 3.1. Explain any excess in the PR.
- Keep the team's notes in `.agents/notes/`: choices and why, what was tried, where work stopped. Use `.tmp/` for scratch files.
- Follow the test rules in section 3.14. Do not assert wording.
- Use plain English. The banned terms are listed in section 3.17 of the spec.
- Never change Pi's files. If Pi lacks a hook, work around it in the extension. Changing how a running Pi draws is allowed only in `src/compact.ts`, only on the Pi versions listed there, and it must pass through when off and put Pi back on `/bruv-compact off` and at shutdown.
- Squash-merge PRs. Use one imperative line for commit messages, with an optional short body.
- Before committing: `bunx biome ci . && bun run check && bun test && bun run test:site`. `site/` is a Bun workspace; its browser checks are in `site/README.md`.
