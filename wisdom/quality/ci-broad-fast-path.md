# Broad fast CI: source validation + immutable web payload

Research only, 2026-09-30; no code/workflow edits. Read the selective design, external research, review, timing audit, and values. Parent owns integration.

## Recommendation

**Stop treating a root source commit as a request to rebuild and retest the separately pinned web product.** Make routine PR validation a source-only lane: frozen root install, fresh Pi assets/host adaptation, format/lint/typecheck, Bun affected tests, and explicit source/process consumer groups. Keep genuine packaging checks in a separately named full merge/release lane. The best immediate broad class is **the remote subsystem**, not another pure leaf.

Historical scan at HEAD cac5578, latest 100 non-merge commits, comparing each commit to its parent:

- 95/100 do not touch integrations/t3/** or src/t3/web/archive.ts.
- 85/100 also avoid scripts/build.ts, package.json, and bun.lock: deliberately conservative existing-producer key stability estimate.
- 58/100 touch only src/**, tests/**, wisdom/**, docs/** or Markdown, excluding those web inputs. Of these, 26 contain source edits; 23 contain remote source edits.
- **20/100 touch only src/remote/**, tests/remote-*, and documentation.** This is already four times the entire previous 5% fast population, before general source/test expansion.

These are eligibility candidates, not proof of complete consumer coverage or <60s hosted results. Markdown here is a counting category, NOT a skip allowlist; prompts/release/runtime-consumed docs remain real inputs. Dependency/build/unknown changes still go broad. The 85% figure is payload reuse opportunity, not fast-test eligibility.

## Measurements and actual bottleneck

Local existing installed dependencies, Bun 1.4.2; no builds or paid/network acceptance:

- bun test ./tests --changed=HEAD: 5 untracked research notes, zero affected tests; **126ms Bun / 225ms process elapsed**. This measures scanner overhead on a no-impact diff, not correctness.
- Five remote files (capabilities, client, runtime, repository-wire, human-rendering): **39 pass, 324ms Bun / 394ms elapsed**.
- All remote-*.test.ts EXCEPT remote-e2e, remote-jobs-e2e, remote-ssh: **119 pass across 16 files, 3.44s Bun / 3.52s elapsed**. Includes capability persistence/revocation, SQLite lock behavior, repository snapshots, delivery, extension and menu behavior; this is not just rendering leaves.
- Existing archive is **104 MiB**, binary 192 MiB. Do NOT download this payload for every source-unit job just to benefit from caching.
- Hosted timing audit: web-inclusive build **133s**, root tests **141s**, upstream checks ~44s; format/lint/typecheck/etc ~3s. Packing ~17–18s, actual target compilation ~1–2s. These are prior measured hosted costs, not new measurements.

Remote tests above exclude SSH/end-to-end and real rendered source-CLI acceptance. Add the applicable existing source CLI / offline menu PTY consumers before certifying remote eligibility. Source launcher imports web only in its web branch, so non-web source CLI tests can avoid archive restore. A compiled build cannot: embedded.ts has a static file import of dist/die-web.archive.gz.

## Small architecture, not a graph engine

1. Always start a PR policy job; resolve exact baseline and tested head, fetch necessary history, and use complete NUL-delimited Git changes. For PRs compare the actual tested merge candidate to target baseline, not a different checkout. For pushes use last successfully validated develop ancestry. Missing history/unknown input fails broad.
2. Root source lane does NOT call the build-first package test script. Prepare root assets freshly, then run Bun test --changed=<resolved-base> over the source-test population. Bun handles imported direct/transitive consumers; package/lock/toolchain changes explicitly invalidate everything appropriate.
3. Maintain a **small list of subsystem/process ownership groups**, not a custom import graph. Remote, history, Live, task/execute, UI/questions, web adapter, and packaging are sensible existing boundaries. Any remote source change selects the measured remote source group plus its source CLI/PTY consumers. Inline imports inside spawned -e strings, filesystem reads, text fixtures, computed imports, and dist/die subprocesses require these explicit edges. Add/delete/rename and shared helpers need both endpoint ownership; uncertain cases select the owning whole group or full lane. Zero Bun-selected tests is not automatically success for executable edits.
4. Split mixed source/compiled files (notably pi-host and CLI/process fixtures) into genuine behavioral source tests and standalone packaging assertions. An executable-path fixture can force a source wrapper for execute/process behavioral tests; never silently default to old dist/die. CLI standalone PATH=/nonexistent, embedded archive/native helpers, installer smoke, old updater, final browser binary boot/reload remain packaging evidence, not source-test claims.
5. Start with broad remote ownership: its 16-file group costs only 3.5s locally. Then expand other subsystem groups using timings and mutation trials. Shadow Bun selection against full runs and inject direct/transitive/process/fixture changes before advertising coverage.

## Immutable web artifact contract

Create one web-payload producer and a compile-only consumer. Compile consumes an already packed, verified archive; no bootstrap copying, directory mutation or repacking per target. Current --reuse-web only checks directory existence/chunks and then rewrites/repackages: **not a sufficient trusted-reuse boundary**.

Canonical input key (schema version + SHA-256 of canonical manifest):

- Upstream repository/revision AND resulting clean patched source tree identity; canonical patch bytes. The pinned tree incorporates upstream pnpm-lock.yaml, package manifests, pnpm-workspace.yaml (including supportedArchitectures), .npmrc, bundler/type/build configs, scripts, licenses and assets. Hash the entire resulting tree rather than manually enumerate its paths.
- Owned producer code: integrations/t3/build/**, bootstrap.mjs, packer src/t3/web/archive.ts, packing exclusions/format; include scripts/build.ts until preparation is actually separated. Conservatively hash integrations/t3/**. Include verification policy/tests digest separately in provenance so changed checks cannot inherit an old validation claim.
- Actual Bun, Node and pnpm versions (not labels on download-cache keys); builder image/toolchain identity, OS/architecture/libc and native install/build configuration. SOURCE.txt currently embeds Bun version and platform/arch. Portable optional dependencies do not make the build automatically platform-independent.
- Root dependency lock/manifest wherever tools used by the producer come from; a conservative first key includes bun.lock and package.json. Narrow later only after a real input audit.
- Fixed production build mode/commands, environment and workspace layout. Use a clean isolated checkout, no inherited .env/.env.local or ignored build outputs; sanitized environment with explicit allowed values. Pin NODE_ENV, timezone/locale, install configuration and canonical work paths, then hash the allowed build environment. DIE_T3_SOURCE is only a locator: reject a tree not matching the declared identity.

Concrete hidden env inputs found in the current patched upstream: loadRepoEnv reads root .env and .env.local, aliases T3CODE_* to VITE_*; web config uses APP_VERSION, VITE_HTTP_URL/WS_URL, relay/Clerk/tracing/hosted-app keys, VERCEL_* fallback URLs, T3CODE_WEB_SOURCEMAP and development flags. Server config uses T3CODE_PACK_EXE/TARGET. Do not key just source pin + patch, nor bake arbitrary runner env or secrets into artifacts. Fresh checkout/no env files + a fixed explicit build environment is simpler and safer than hashing every inherited variable. verifyWebSource currently excludes ignored files, so that check alone does not exclude ignored env/config contamination.

Provenance records key manifest, archive digest/size, source/patch digests, toolchain/environment, producer repository/workflow/ref/run/commit and successful verification scope. Artifact identity can span different die commits when all payload inputs match; **CLI/source/integration test proof cannot**.

Use exact-key lookup of immutable artifacts from successful trusted protected-branch producers, verify origin and bytes, and stage atomically. No prefix restores for payloads. A hash beside an untrusted archive is not trust. Fork/PR producers never publish into the protected namespace; do not use pull_request_target to execute PR code. Dependency download caches remain separate and still require frozen installs. On a miss, rebuild freshly in an explicit slow lane; never silently use local dist or claim the fast budget. Source-only tests need no artifact unless they actually enter web behavior.

## Honest tiers and <60s budget

Required status: **PR source/affected validation**, with exact selection/reasons and test counts, not “all tests passed.” Always-run aggregator must fail for missing/failed/cancelled selected jobs or classifier errors. Source gate has no Node/pnpm/web/tmux provisioning unless selected consumers require it.

Full merge-candidate validation retains source + web integration + packaging gate union; merge queue is the cleanest owner. Without a queue, require the actual PR merge-candidate full gate. Nightly runs full as selector/environment backstop; release still validates final exact-SHA assets, native platforms, transport, browser and updater, notices/provenance/checksums. Nightly alone is not equivalent to enforced full premerge validation. Packaging-policy tier changes must be explicit, not a misleading green full-CI status.

Aim for runner-start-to-result p95 <60s on source classes: ~15–25s checkout/setup/frozen install/assets and checks, <=25–30s selected tests, ~5s reporting. These are proposed budgets, NOT measured hosted promises; queue latency is separate and must be reported. Record cold and warm costs, selected-file counts and payload misses.

For groups exceeding the test budget, use duration-balanced **safe process shards**, not indiscriminate concurrency: pure/module + remote model; source execute/tasks; UI/PTY; packaging/full-only. Bun 1.4.2 advertises --parallel=N (isolated globals), but that does not isolate HOME/TMPDIR, fixed ports, file outputs or PTY/server ownership. Audit those resources first; prefer separate shard processes/jobs with unique HOME/TMPDIR/XDG state, ports and cleanup. Do not shorten behavioral deadlines. Broad shared changes may remain >60s; label them full/broad rather than time out or drop tests.

**Next parent action:** source-only remote group + explicit source CLI/PTY coverage and trustworthy validation-tier statuses, alongside prepare-once/compile-only web payload plumbing. That targets ordinary executable commits now; artifact reuse removes the dominant rebuild tax when compilation is genuinely selected. No code edits made; values unchanged because existing truth-of-proof and ownership values already cover this design.
