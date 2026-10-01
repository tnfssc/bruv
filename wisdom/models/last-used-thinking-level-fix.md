# Remember the last CLI thinking level

Worktree: /home/tnfssc/.bruv/worktrees/die-a86675007a5e-task_1ab23236
Branch: bruv/remember-thinking-level-in-new-sessions-1ab23236
Date: 2026-10-01

Read values.md, last-used-model-fix.md, last-used-model-followup.md and model-integration-final.md. The follow-up matters: the original web investigation was followed by a user clarification that terminal was affected, and an automatic CLI model-default persistence fix. Source moved from src/tasks to src/agent since that note.

Findings

Current T3 pin is b488c57f3f9f1688e31c53daee99e29dd1d0baa2, not the old a9b49a7d pin. Inspected a disposable checkout at /var/tmp/bruv-thinking-1ab23236 with this worktree's canonical integrations/t3/upstream/bruv.patch applied. TraitsPicker calls setProviderModelOptions with model, instanceId and persistSticky: true. composerDraftStore already persists sticky model options and per-model/provider option memory, and applyStickyState seeds new drafts. Existing tests cover this memory, reload and new drafts. No new web defect was confirmed; no canonical patch edit is needed for this omission.

The actual CLI gap is src/agent/last-used-cli-model.ts: it listened only for model_select and saved provider/model, not thinking preferences. Pi 0.99.1 has thinking_level_select. The interactive thinking cycle and picker call session.cycleThinkingLevel / setThinkingLevel, which emit that event. Bruv now saves its level with SettingsManager.setDefaultThinkingLevel in root TUI sessions only, flushes the lock/merge-aware settings write, and warns on errors. The extension registration already supplies the dynamic root-depth guard. Children and print/JSON/RPC calls do not open settings.

Pi startup's SDK resolves explicit thinking override first, resumed transcript next, then per-model/global defaults and capability clamping. Startup/history assignment does not emit thinking_level_select; saved preferences therefore do not overwrite resumed history or explicit startup overrides. Model-only persistence still leaves the thinking default untouched.

Tests

- bun test tests/last-used-cli-model.test.ts: 7 passed, 0 failed (28 assertions).
- Three new thinking tests fail against the original CLI module because no thinking handler is registered, then pass with the fix.
- Temporary settings files prove high and off survive fresh SettingsManager instances while provider/model/theme remain unchanged. Tests cover automation/child exclusion and write-error notification. Existing model restore/cycle coverage stays intact.
- In the pinned disposable web checkout, vp test run src/composerDraftStore.test.ts: 146 passed. Reused existing root and workspace node_modules via temporary symlinks; no dependency install.
- node_modules/.bin/tsc --noEmit: passed with existing runtime-assets temporarily linked from /home/tnfssc/Code/die. Biome formatting and git diff --check passed.

Gaps and limits

Normal bun run check cannot finish prepare:assets with the reused dependency tree: Unsupported Pi host file: dist/main.js (host adaptation hash mismatch). Did not modify the shared dependency host to force this gate. Direct typechecking passed once existing runtime assets were linked. Temporary dependency/runtime links in the task worktree were removed before commit. No build, install, release, version bump, provider call, or user settings mutation.

No live rendered terminal/browser acceptance was run. Tests exercise event handling and actual isolated settings persistence, not keypress rendering. Pi's thinking event has no provenance/source field: a programmatic root-TUI setThinkingLevel (including model-switch capability adjustment) also updates the last effective thinking default. Bruv currently has no internal pi.setThinkingLevel call; this is not an arbitrary third-party-extension intent guarantee. Per-model startup pins and explicit overrides retain Pi's normal precedence over the global remembered preference.

Values unchanged: this is a local omission covered by the existing trace-real-paths, focused-proof, and leave-a-handoff principles, not a new general value.
