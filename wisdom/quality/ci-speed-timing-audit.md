# CI speed timing audit

Research on 2026-09-30. Worker task_38d31012. No changes from this audit.

## Findings

Read-only audit completed using `gh`, workflows, scripts, `wisdom/values.md`, and CI/release wisdom. **No repository edits, cancellations, dispatches, or release changes performed.**

Protected run **36750929320 finished successfully at 17:38:36 UTC**, taking **16m00s**.

### Measured timings

| Run | Event | Total elapsed | Main Linux job |
|---|---|---:|---:|
| CI 36750913827 | develop push | 6m18s | 6m13s |
| CI 36703153195 | develop push | 7m37s | 6m50s |
| CI 36687838150 | develop push | 5m36s | 5m31s |
| Release 36750913725 | develop dry run | 10m44s | 8m47s |
| Release 36703153676 | develop dry run | 10m25s | 8m45s |
| Release 36687838321 | develop dry run | 10m54s | 8m47s |
| Release 36704291531 | tag, reused assets | **2m56s** | No rebuild |
| Release 36750929320 | manual publication | **16m00s** | 9m03s |

PR CI **36684947568** took **24m33s**, but Linux execution was only **6m45s**: approximately **17m47s was queue/start delay**. Faster scripts alone cannot fix that case.

### Critical path: protected manual run

- Preparation: **10s**
- Native Mac helper: **26s**
- Linux release job: **543s**
  - Dependency-store restore: **18s**
  - Build test binary, including web: **165s**
  - Deterministic tests: **159s**
  - Four release builds: **75s**
  - Web backend verification: **46s**
  - Asset upload: **24s**
- Final Linux browser job: **309s**
  - Browser harness installation: **276s**
  - Actual browser boot/reload verification: **17s**
- Publication: **49s**
- Remaining time: job setup, dependency transitions, and scheduling.

The browser installation downloaded **34.9 MB of Ubuntu packages in 4m15s**. Chromium downloads occurred afterward and were comparatively quick. **This outlier was primarily apt/network latency, not the browser test.**

For latest CI, the shared Linux gate took **321s**:
- Build: **133s**
- Web verification lanes: approximately **44s**
- Deterministic tests: **141s**
- Everything else: approximately **3s**

## Ranked changes

### 1. Pack the embedded web archive once, then compile targets
**Likely saving: 50–65s per release. High confidence.**

`--reuse-web` avoids rebuilding web, but **still repacks `dist/die-web.archive.gz` for every target**. Manual-run logs show the **same archive SHA-256 four times**, with roughly **17–18s between each pack**; target compilation itself takes roughly **1–2s**.

Reuse the already validated, packed archive within that build. Keep chunk validation and input/provenance checks.

**Do not simply background existing target commands:** they all copy bootstrap files and rewrite the same archive. Separate preparation from compilation first.

### 2. Remove browser setup from the post-build critical path
**Likely saving: 20–45s normally; approximately 250s in this outlier.**

The browser job currently starts only after asset staging. Provision browser tooling earlier, concurrently with release construction, then fetch and test the final binary.

Also investigate using the hosted runner’s installed Chrome through existing `RELEASE_BOOT_CHROMIUM`, with recorded browser version and a successful gate proof. Alternatively provision a pinned browser in a controlled image.

**A Chromium cache alone does not fix the measured 255s apt bottleneck.** Avoid blindly restoring system libraries or trusting an undocumented browser installation.

### 3. Parallelize independent verification after the build
**Likely saving: 35–60s in CI/release. Medium confidence.**

After build completion, root deterministic tests and upstream web verification are currently serial. They can potentially run concurrently, using distinct logs and isolated temporary state.

Keep smoke/final-artifact verification dependent on the required successful checks. Check CPU/RAM contention: larger parallel jobs can erase the saving.

### 4. Shard deterministic tests by resource-safe groups
**Likely saving: 50–90s; requires measurement.**

The root suite consumes **141–159s**. Several tests deliberately wait for real deadlines, PTY interactions, or process cleanup: observed individual tests take **3–9s**.

Prefer separate jobs/processes with isolated HOME/TMPDIR, ports, sessions, and PTY ownership. Balance shards by measured duration, not file count.

**Do not globally enable concurrency or shorten behavioral deadlines merely to get green tests faster.**

### 5. Consolidate push CI and Release validation ownership
**Saving: approximately 4–5 runner-minutes per develop SHA; wall-time saving depends on design.**

The latest develop push ran both:
- CI: **133s build + 141s root tests**
- Release dry run: **153s build + 155s root tests**

That is approximately **274s of repeated build/test execution**. Their web checks differ, so retain their **union**, not just whichever lane is easier.

Use one trusted validation/build producer per exact SHA, with release packaging consuming its outputs. Preserve useful PR checks and required check names. Consolidation also reduces queue pressure.

Manual preparation is different: this run created **b86f17f**, preparing v0.15.14. The push dry run tested **7d652d3**. **Those are not interchangeable final release inputs.**

### 6. Extend safe reuse to manual requests only when applicable
**Potential saving: roughly 8–9 minutes for an already verified exact SHA. Not available for a newly prepared commit.**

Tag releases already reuse successful develop assets: observed **2m56s versus roughly 10m30s** for rebuilding.

Current manual requests always take the full build path; reuse lookup is tag-push-only. Reuse could apply when preparation produces an unchanged SHA with a completed trusted dry run.

Keep exact repository/workflow/event/branch/SHA matching, successful completion, unique unexpired artifact, and final binary checks. The bot preparation push normally **does not trigger another workflow**, so do not design a manual run to wait for a nonexistent push dry run.

### 7. Fix cache invalidation, but do not expect dramatic gains
**Likely saving: seconds, not minutes.**

- Develop CI/dry-run had warm Bun and pnpm caches.
- Manual preparation changed `package.json`, causing a **Bun package-download cache miss** despite unchanged dependencies.
- pnpm stayed warm: **848 reused, zero downloaded**.
- pnpm restore itself cost **18–19s**.

Consider dependency-content keys rather than version-only package changes, with safe download-store fallbacks. Keep actual tool/platform/source-pin/patch inputs.

Existing cache wisdom already measured cold versus warm Linux jobs at **394s → 393s**: download elimination was proven; meaningful overall acceleration was not.

## Guards that must remain

- Locked dependency installation; formatting, linting, typechecks.
- Union of current CI/release web backend, model, contracts, projection, cache, and terminal-recovery checks.
- Deterministic root tests, offline transport verification, standalone smoke.
- Native sanitizer/protocol tests and embedded Mac helper checks.
- Real Linux release binary **initial browser boot and reload**, error detection, SHA-linked proof, failure artifacts.
- Actual Linux/macOS old-updater compatibility.
- Final binary checksums, notices/licenses, source and patch provenance.
- Publication only after successful gates; exact prepared SHA, develop/tag consistency, atomic tag conflict handling, draft asset size/digest verification.
- No caches of credentials, user state, patched source, or unchecked stale `dist`.

**Best first implementation:** pack once, overlap browser provisioning, then overlap independent validation. Together these plausibly remove **1½–3 minutes normally**, and substantially more when browser provisioning stalls. Measure hosted before/after runs before claiming improvement.
