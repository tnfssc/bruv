# Production-v2 historical archive (retired)

The frozen code/config inputs and probes were retired on 2026-10-02 with user approval. Historical prose and preservation evidence remain. The description below records the former layout, not files available in this checkout. At that retirement, T3 features and `integrations/t3` were unchanged. The old bundled integration was later removed on 2026-10-04; see [the removal record](../../../quality/obsolete-integrations-removal.md).

Retrieve the exact pre-retirement tree from Git revision `65e3242de4206cd8b123ffbc35c1f233bd7ce536`:

```sh
git archive 65e3242de4206cd8b123ffbc35c1f233bd7ce536 experiments/t3/production-v2/archive | tar -x -C /path/to/empty-replay-directory
```

Use a separate directory; do not restore old inputs over the maintained integration. See [retirement scope and checks](../../../quality/t3-archive-retirement.md).

## Historical layout

`archive/` is a byte-for-byte relocation of tracked historical inputs and probes. The old `scripts/t3-v2-production/{build-candidate,export-candidate,export-worktree}.ts` are under `archive/scripts/`; candidate patch, pin, export metadata, and README are under `archive/.agents/patches/`; lifecycle rollback snapshots are under `archive/.agents/rollback/t3-v2-lifecycle/`. The later incremental model-selection and backend-refinement patches are also preserved under `archive/.agents/patches/`; neither is an active input. The general pre-v0.5.4 index snapshot is at `wisdom/wisdom-system/index-pre-v054.md`, not this subsystem.

`archive/scripts/die-web-{mode,model,smoke,stop}-smoke.ts` use the old `.cache/die-t3code` checkout. `archive/scripts/leak-audit/` holds older source probes tied to pin `719a76ca1dbf5490f1aa33ffb9966301e02be9a9` and `web/t3.patch`, plus the old stale-checkout probes. Their “current” labels describe the era they were written in, not the current production pin. They retain original relative paths and references; moving them does not make them runnable from this location. Port intentionally before reuse. No archived script is a release gate.

The old canonical bundled inputs and offline T3 gates were also retired.
Current builds produce the Bruv CLI and Claude-compatible connector; T3 is
installed separately. Generic CLI probes stay under `scripts/leak-audit/`.
The archived candidate builder is not part of current build source guards.
No archive is executed automatically.
