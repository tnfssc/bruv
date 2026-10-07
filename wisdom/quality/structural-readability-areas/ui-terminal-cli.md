# UI / terminal / CLI structural readability

101 baseline files; all pending. This is an ongoing area, not whole-repo acceptance.

Workspace: /home/tnfssc/.bruv/worktrees/t3-6b8c09c6-5442693331ce-task_f8e968d6
Branch: bruv/whole-repo-structural-readability-ui-ter-f8e968d6
Initial area commit: 59413c532e6422983f611915e509e8421aa2f363

## Pipeline and pickup

The adjacent JSON is authoritative per-file work/round/hash coverage. Up to three primary/rework writers and three fresh read-only judges run concurrently. Writers own source changes in retained worktrees; coordinator joins accepted diffs only and excludes worker-local pickup notes. Unchanged source still requires an independent actual-code judgment. Related final changes invalidate earlier hash acceptance. Extra/new/deleted paths are tracked separately.

First independent focus domains: CLI entry, editor lifecycle, terminal action profiling. Later primary workers launch from committed integrated area state. No area push or PR. Parent owns PR #45.

## Proof and limits

No source acceptance or runtime proof yet. Shared read-only dependencies and explicit Bun PATH are required. Focused checks per actual edit; combined gates at batch boundaries. Live/provider/device/SSH limits remain explicit.

## Accepted editor lifetime patch

Primary task_ff96b465; judge task_14234cb0 ACCEPT candidate 58af8f98e82c5d0ad6e34422cc2aafb9f5126ba7. Hook teardown and protocol restoration now sit with their setup; attachment shows one idempotent session lifetime. Exact accepted blobs and proof are in JSON. Writer: 40 editor/startup/controller + 10 live caller checks; baseline characterization 15 passes, focused Biome/diff clean. Judge rerun hit dependency resolution (no independent test-pass claim). No full build/typecheck/device/provider proof.

Cross-area: tests/editor-voice-integration.test.ts accepted as related patch at 95453da9cb3f0827a96b955c60f854e905939dac; Live/native-audio primary must reconcile final blob. Worker-local notes excluded.

## Accepted CLI boot boundaries

Primary task_75c8d308; judge task_db22e114 ACCEPT candidate f27f3d73c76d754b0c19bdc0d561657fc5f66b0b. Shared environment setup, remote dispatch, and local SDK/UI lifetime now read separately; help transformation no longer interrupts acquisition/cleanup. Bodies/import/cleanup ordering retained. Independent 6 startup checks + 87 focused caller checks; Biome exits 0 with existing advisories; no compiled/full-gate/TTY/provider/SSH proof. tests/cli.test.ts still needs its own primary focus despite patch acceptance.
