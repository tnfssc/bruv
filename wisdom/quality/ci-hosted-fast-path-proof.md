# Hosted PR fast-path timing proof

Measured 2026-09-30 on current CI implementation `ec3ce32350db4a9454f5bac872fa132430832147`. Remote develop verified at that SHA before PR creation and both selector logs independently resolved it as the tested merge's base.

Draft probe: https://github.com/tnfssc/die/pull/10 (closed without merge after measurement). Unique owned branch: `die/measure-hosted-selective-source-ci-b43e6c1d`; durable worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_b43e6c1d`. Remote branch retained. Only this branch was pushed, using normal commits. Full baseline push run was not canceled. No workflow, tests, policy, protection, develop, or release changes. This evidence is written outside probe branch.

## Result

Broad remote-source succeeded but strict **<60s was not met**: 60s created-to-completed at API second resolution (59s to last job completion). Docs succeeded in 20s. One sample per class; no p95 or statistical performance claim. Full producers skipped as planned, not equivalent to full validation success.

Timing definition: Actions API created_at to terminal updated_at, corroborated by completed job timestamps. API timestamps have second resolution; last-job completion also shown. Queue figures are observable scheduling gaps, not pure runner queue metrics.

## Broad remote-source

Run: https://github.com/tnfssc/die/actions/runs/36762861032

- Head commit: `fddd2a2b661f04c6d7a501a1fda3afec0a70c2a1`
- Tested merge SHA (selector head): `bef84082f781c507645707b8ec44d839be89c437`
- Net PR diff: one comment added to src/remote/client.ts
- Plan: mode=selected, class=remote-source (BROAD, not human-rendering narrow); full=false.
- Created/start: 2026-09-30T19:02:28Z; terminal updated: 2026-09-30T19:03:28Z; last job completed: 2026-09-30T19:03:27Z.
- End-to-end: **60s**; last-job endpoint 59s. Conclusion: success.
- Initial scheduling gap: 4s; feedback→policy start gap: 3s; final job→terminal update: 1s.

### Jobs and steps

| Job / step | Duration seconds | Outcome |
|---|---:|---|
| **Selected feedback (not full validation)** | 48 | success |
| ↳ Set up job | 2 | success |
| ↳ Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 | 3 | success |
| ↳ Run oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 | 1 | success |
| ↳ Resolve complete comparison | 0 | success |
| ↳ Plan validation | 0 | success |
| ↳ Run selected checks from clean source | 35 | success |
| ↳ Post Run oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 | 1 | success |
| ↳ Post Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 | 0 | success |
| ↳ Complete job | 0 | success |
| **CI policy** | 4 | success |
| ↳ Set up job | 0 | success |
| ↳ Require the planned validation outcomes | 0 | success |
| ↳ Complete job | 0 | success |
| **Full validation / macOS Live (no devices or API)** | 0 | skipped |
| **Full validation / Linux x64** | 0 | skipped |

### Actual commands and measured subprocess durations

```text
2026-09-30T19:02:40.0853092Z ==> ["bun","install","--frozen-lockfile"]
2026-09-30T19:02:40.8795203Z elapsed ms: 794
2026-09-30T19:02:40.8795588Z ==> ["bun","run","prepare:assets"]
2026-09-30T19:02:40.9045203Z elapsed ms: 25
2026-09-30T19:02:40.9045785Z ==> ["node_modules/.bin/biome","format","src/remote/client.ts"]
2026-09-30T19:02:41.1295199Z elapsed ms: 225
2026-09-30T19:02:41.1295569Z ==> ["node_modules/.bin/biome","lint","src/remote/client.ts"]
2026-09-30T19:02:41.1966947Z elapsed ms: 67
2026-09-30T19:02:41.1967155Z ==> ["bun","run","check"]
2026-09-30T19:02:43.1398544Z elapsed ms: 1944
2026-09-30T19:02:43.1399247Z ==> ["bun","test","./tests/ci-selective.test.ts","./tests/ci-remote-source.test.ts"]
2026-09-30T19:02:45.9442785Z elapsed ms: 2804
2026-09-30T19:02:45.9446031Z ==> ["bun","test","tests/remote-artifacts.test.ts","tests/remote-capabilities.test.ts","tests/remote-capability-runtime.test.ts","tests/remote-client.test.ts","tests/remote-extension.test.ts","tests/remote-human-rendering.test.ts","tests/remote-job-artifacts.test.ts","tests/remote-job-delivery.test.ts","tests/remote-job-observations.test.ts","tests/remote-jobs.test.ts","tests/remote-menu.test.ts","tests/remote-owner.test.ts","tests/remote-repository-wire.test.ts","tests/remote-repository.test.ts","tests/remote-runtime.test.ts","tests/remote-session-switch.test.ts","tests/remote-ssh.test.ts","tests/ci-remote-cli-source.test.ts","tests/live-spoken-tui.test.ts"]
2026-09-30T19:03:05.4219348Z elapsed ms: 19478
2026-09-30T19:03:05.4222271Z ==> ["bun","test","tests/execution-previews.test.ts","tests/goals-live.test.ts","tests/herdr-agent-state.test.ts","tests/job-attention.test.ts","tests/job-bridge-protocol.test.ts","tests/job-service.test.ts","tests/live-host-access.test.ts","tests/live-host-bridge.test.ts","tests/live-main-owner.test.ts","tests/prompt-delivery.test.ts","tests/stop-work.test.ts","tests/subagent-extension.test.ts","tests/t3/native-routing.test.ts","tests/tool-schema.test.ts","tests/worktree-workspace.test.ts","--changed=ec3ce32350db4a9454f5bac872fa132430832147"]
2026-09-30T19:03:09.6847731Z elapsed ms: 4263
2026-09-30T19:03:09.6867904Z ==> ["bun","test","./tests/pi-host.test.ts","--test-name-pattern","^source CLI"]
2026-09-30T19:03:14.8276673Z elapsed ms: 5143
```

Test batch outcome lines:
```text
2026-09-30T19:02:45.9432652Z  35 pass
2026-09-30T19:02:45.9433144Z  0 fail
2026-09-30T19:03:05.4170782Z  123 pass
2026-09-30T19:03:05.4171284Z  0 fail
2026-09-30T19:03:09.6794104Z  80 pass
2026-09-30T19:03:09.6794974Z  0 fail
2026-09-30T19:03:14.8232588Z  2 pass
2026-09-30T19:03:14.8233003Z  0 fail
```

## Docs-only

Run: https://github.com/tnfssc/die/actions/runs/36763069298

- Head commit: `3ad2b1c365a8f8f64e44ebe3a6ce7d88ec6b7aca`
- Tested merge SHA (selector head): `b5210232d9841a154ce447ecaee860ae02f5301c`
- Net PR diff: README.md HTML comment only; source comment removed in a normal additional commit
- Plan: mode=docs; full=false.
- Created/start: 2026-09-30T19:04:13Z; terminal updated: 2026-09-30T19:04:33Z; last job completed: 2026-09-30T19:04:33Z.
- End-to-end: **20s**; last-job endpoint 20s. Conclusion: success.
- Initial scheduling gap: 4s; feedback→policy start gap: 3s; final job→terminal update: 0s.

### Jobs and steps

| Job / step | Duration seconds | Outcome |
|---|---:|---|
| **Selected feedback (not full validation)** | 9 | success |
| ↳ Set up job | 1 | success |
| ↳ Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 | 2 | success |
| ↳ Run oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 | 1 | success |
| ↳ Resolve complete comparison | 0 | success |
| ↳ Plan validation | 0 | success |
| ↳ Run selected checks from clean source | 2 | success |
| ↳ Post Run oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 | 0 | success |
| ↳ Post Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 | 0 | success |
| ↳ Complete job | 0 | success |
| **CI policy** | 4 | success |
| ↳ Set up job | 0 | success |
| ↳ Require the planned validation outcomes | 0 | success |
| ↳ Complete job | 0 | success |
| **Full validation / macOS Live (no devices or API)** | 0 | skipped |
| **Full validation / Linux x64** | 0 | skipped |

### Actual commands and measured subprocess durations

```text
2026-09-30T19:04:22.5357166Z ==> ["bun","test","./tests/ci-selective.test.ts"]
2026-09-30T19:04:24.0176862Z elapsed ms: 1482
```

Test batch outcome lines:
```text
2026-09-30T19:04:24.0175347Z  28 pass
2026-09-30T19:04:24.0175677Z  0 fail
```

## Overhead and fidelity

Source selected commands sum to 34.743s; install --frozen-lockfile took 0.794s (136 packages, package manager reported 789ms). Bun setup step took 1s; checkout 3s; feedback job total 48s includes 35s selected step plus setup/post-job/runner overhead. No full T3 installer or package cache restoration ran on this selected path. Source prepare:assets ran (25ms); check ran (1.944s). Docs ran selector tests only (1.482s), no package install; Bun setup 1s, checkout 2s, feedback total 9s. No prepared-deps flag used.

Both runs executed plan and selected-run commands `bun scripts/ci-selective.ts --base "$BASE"` (selected execution adds `--run`) and CI policy required feedback success with mode selected/docs, full=false, and both full producers skipped. Logs inspected, including actual emitted commands above; no test failures or policy workarounds. API snapshots and complete logs retained locally at `/tmp/ci-timing-b43e6c1d/` (temporary, run URLs above are hosted evidence).

Local shell startup emitted an untrusted mise.toml warning; no trust/config change performed. Git SSH printed an unsupported id_rsa warning but pushes and remote verification succeeded via available authentication. No local Bun execution was required.

## Parallel follow-up: 46 seconds

Run https://github.com/tnfssc/die/actions/runs/36770502052 on draft PR11. Base b08f5c4bd574da41ebcbc85c2c9bbdba05a2b9c0; source probe cbbb31cc0784ab0983d3ae9e63cf452dfe689229 adds only a comment to src/remote/client.ts. Correctly selected remote-source. Created2026-09-30T20:08:14Z; completed/updated20:09:00Z: **46s end-to-end**. Feedback job35s (20:08:18–20:08:53), policy4s (20:08:56–20:09:00), includes scheduling/setup/teardown. Full Linux/macOS skipped by selected policy. PR closed without merge; branch/worktree retained.

All same selected commands ran. Frozen install965ms, preparation28ms, format280ms, lint75ms, typecheck2115ms, selector/policy tests3515ms. Three overlapping processes exited0/0/0: remote group21957ms, affected reverse6354ms, source CLI contracts7936ms. This is one hosted follow-up, not p95. The14s end-to-end improvement over60s includes scheduling variance; do not attribute all14s to overlap. Local controlled comparisons measured6.4–8.2s savings.

This demonstrates under-minute source feedback for the audited remote tier. Docs previously20s. Other shared/high-risk/unknown classes still take full validation; historical candidate coverage is not a claim all historical commits were tested. Logs: /home/tnfssc/.die/ci-parallel-source-probe.log.
