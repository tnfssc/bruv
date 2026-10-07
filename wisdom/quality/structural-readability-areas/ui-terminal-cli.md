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
