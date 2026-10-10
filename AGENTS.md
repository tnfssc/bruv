# Working on bruv

- Read `docs/REWRITE.md` (until merged) and the module you change.
- Follow the module line budgets in section 3.1. Explain any excess in the PR.
- Do not write notes, logs, evidence, or "proof" files into the repo. Put decisions in the PR description. Use `.tmp/` for scratch files.
- Follow the test rules in section 3.14. Do not assert wording.
- Use plain English. The banned terms are listed in section 3.17 of the spec.
- Do not patch Pi prototypes. If a hook is missing, open an upstream issue and work around it in the extension.
- Squash-merge PRs. Use one imperative line for commit messages, with an optional short body.
- Before committing: `bunx biome ci . && bunx tsc --noEmit && bun test`.
