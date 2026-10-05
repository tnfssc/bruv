# Cheap checks before push — proposal only

User asked to implement Linux gate alignment and a bounded fixture audit. This item is a proposal. No hooks, actionlint installation, new check command, workflow validation step, or required check is added by this work.

## Problem shown by history

The [failure audit](../quality/ci-release-failure-audit-2026-10-05.md) found 23 format/JSON-parse failed runs across 16 SHAs. Type/lint failures also reached Release. Both workflow files were rejected before jobs because runner.temp was used in a job-level env where the context was not legal. YAML parsing and literal command assertions did not catch that.

## Suggested first step

Add one explicit local command, for example ci:quick, after approval. Reuse existing format:check, lint and check. Do not auto-fix files or add another full test/build run. check already prepares required assets and runs tsc. Dependencies must first be installed from the frozen lockfile; missing setup should produce a clear failure, not silently skip a check.

Check the whole current tree by default. It is small enough and tsc needs the complete project. A changed-files formatter shortcut can come later only if time actually warrants it. Checking only staged paths does not prove the commit that will be pushed.

Run against the final tree after integrating worker commits. Later edits invalidate that proof. Show HEAD and describe scope in output; do not build a persisted proof/receipt system. Leave hosted CI authoritative.

Use the existing project action or document the command before considering a hook. Do not install Git hooks or change core.hooksPath automatically. A pre-push hook can be an explicit later opt-in, not part of the first change.

## GitHub-aware workflow validation

Add actionlint only after approval. Pick and pin a vetted release; verify the downloaded binary checksum in CI. Use the same tool version locally and hosted. Check workflow context legality and expressions, not merely YAML syntax. Validate all four workflow files; this is cheap and avoids a new change-classification system.

Run the hosted checker early in Linux validation, before expensive builds/tests. Keep existing required CI policy and Release publication gates unchanged. Supply the tool explicitly through the normal tool bootstrap. Do not depend on a developer's PATH or quietly pass when it is missing.

Keep this to actionlint's workflow checks initially. Do not add a broad ShellCheck rollout, new workflow-check matrix, cache, or unrelated lint rule changes. Disable optional tool integrations if needed to make that scope consistent.

## How to prove the proposed change

- Existing workflows pass the pinned checker.
- A small copy of the historical invalid job-level runner.temp env fails for the right reason.
- A quick-check fixture stops at the first failing command and preserves its exit/output.
- The command does not build, run the full suite, rewrite files, install hooks, or replace hosted proof.
- Try it on the final integrated tree and measure actual time before making it mandatory.

## Not included

No automatic push/merge/release. No mandatory local hooks. No whole-suite rerun for every tiny docs edit. No skipped typecheck, weaker style rules, or automatic repair of invalid YAML. Physical Live/device/provider acceptance remains separate.

Values stay unchanged for this proposal. Existing honest proof, smallest useful change and safe user-state values cover it.
