# Release failure history research — 2026-10-05

## Scope and evidence

Research only. Read `wisdom/values.md`, release and packaging notes, related root-cause notes, current release workflow, and relevant HEAD git history/diffs. No code, workflow, release, tag, installation, or user state changed. Parent is collecting live Actions history; this report uses **recorded** run results and does not claim a fresh GitHub audit. Repository HEAD inspected: `9906f92e0181582c24753230f944100bdf218e55`. Older URLs use `tnfssc/die`; newer ones use `tnfssc/bruv`.

Distinguish:

- **Release workflow/job failure:** publication stopped, or publication partially completed. This does not itself establish a broken shipped app.
- **Green workflow, broken shipped behavior:** publication succeeded but a real user path failed. Passing packaging/HTTP/unit checks did not cover that path.
- **Standard CI failure with successful Release:** different fixture prerequisites/order can make these disagree. Do not call either “all CI green” or automatically “bad release.”
- **Local setup/probe failure:** not a hosted release failure without a recorded hosted run.

## Main findings

Repeated failures are not one recurring GitHub outage. The recorded causes cluster around **nonhermetic fixtures and harnesses**, **differences between standard CI and Release**, **release plumbing**, and a smaller set of **real product regressions**. Repairs generally retained assertions and gates: synchronize on durable work, isolate global SDK state, supply configured tools, fix metadata classification, or fix the actual product. Blind reruns would often execute the old bad SHA.

The clearest green-but-broken releases are **v0.12.0 web Live** and **v0.15.12 browser initialization**. In contrast, the v0.16.4 “rollback failure” was conclusively a **fault-injection fixture path mismatch**, not a production updater failure. The later real browser gate also caught an upstream Tiptap lifecycle defect before publication.

## 1. Broken release jobs / publication plumbing

### Early releases: fixture timing, build defaults, missing final validation

| Version / recorded runs | Actual cause and repair | Outcome / evidence |
| --- | --- | --- |
| v0.2.4 (run ID not recorded here) → v0.2.5 | Release regression depended on local profile settings. Isolate fixture; history commit `f0f34283`. | v0.2.4 stopped before publishing; tag preserved. [v0.2.5 note](../releases/release-v0.2.5.md). Do not invent the missing run ID. |
| v0.2.7: [34776153408](https://github.com/tnfssc/die/actions/runs/34776153408) → v0.2.8: [34777461220](https://github.com/tnfssc/die/actions/runs/34777461220) | Goal SDK test expected waiting → active → completed but short `sleep 0.1` job could finish before handoff. File-gate the real job; release it after the tool-end listener durably records waiting. Production runtime unchanged. | v0.2.7 unpublished. `99464c6` ships test repair/isolation in v0.2.8; 35 repeated focused passes, then hosted release success. [Herdr/release record](../releases/releases-herdr-2026-09-13.md). |
| v0.2.11: [34849330586](https://github.com/tnfssc/die/actions/runs/34849330586) → v0.2.12: [34850093931](https://github.com/tnfssc/die/actions/runs/34850093931) | Node `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`: default patched T3 checkout under `node_modules/.cache`. Local source overrides hid the default-path problem. Move cache to `.cache/die-t3code` and prove a fresh build with `DIE_T3_SOURCE` unset. | No v0.2.11 assets. Fix `882fd527`; v0.2.12 published, downloaded assets/checksums/SOURCE, 351 internal symlinks and real installed browser checks passed. [v0.2.11](../releases/release-v0211.md), [v0.2.12](../releases/release-v0212.md). |
| v0.2.13: [34858461029](https://github.com/tnfssc/die/actions/runs/34858461029) | Recorded workflow failure before publication; **cause not specified** in the inspected release note. Cancellation for a changed packaging request arrived after failure. | No release found. Do not attribute this failure to the later single-binary defects without its logs. Separate local signing failure was full `/tmp`; `TMPDIR=/var/tmp` fixed that. [v0.2.13](../releases/release-v0213.md). |
| v0.2.14: [34873549248](https://github.com/tnfssc/die/actions/runs/34873549248) → v0.2.15: [34876404085](https://github.com/tnfssc/die/actions/runs/34876404085) | “Validate web backend” failed TS1294 constructor parameter properties under `erasableSyntaxOnly` and TS377057 Effect nodeBuiltinImport diagnostics in new PTY tests. Adapter was added **after** earlier backend check; root check did not typecheck ignored T3 sources. Replace parameter properties, use Effect services/schema in tests; put exact backend `tsc` inside buildWeb and PTY tests in CI/Release. | v0.2.14 unpublished, though locally installed build worked. `cd15b040` fixes; 14 real PTY tests no skips, 121 backend tests, v0.2.15 release and official-asset browser checks passed. [v0.2.14](../releases/release-v0214.md), [v0.2.15](../releases/release-v0215.md). |

The Herdr incident also had **local test contamination of user state**, separate from its hosted goal test failure: TUI tests inherited real pane/socket environment and issued release calls to the real pane. User restart restored sidebar; test child environment isolation fixed this. It was not a shipped-release regression and must not be merged into the goal timing diagnosis.

### Native/helper and ordinary test blockers

| Version / recorded runs | Actual cause and repair | Outcome / evidence |
| --- | --- | --- |
| v0.8.0 preparation: [35909683064](https://github.com/tnfssc/die/actions/runs/35909683064) | Gates passed native/build/test stages, then `file(1)` text-match rejected a valid Mach-O description: Linux/macOS order “executable arm64” differently. `c5b6101a` accepts both forms. | Fixed pretag run 35910725315, CI 35910725281; publication [35911787187](https://github.com/tnfssc/die/actions/runs/35911787187) passed. Not a bad helper architecture or device failure. [Native stable update](../releases/native-live-stable-update.md). |
| v0.10.0: [35998994804](https://github.com/tnfssc/die/actions/runs/35998994804) → v0.10.1: [35999297487](https://github.com/tnfssc/die/actions/runs/35999297487) | Two `noSwitchDeclarations` lint errors in Realtime session cases. Add braces; no protocol change. | v0.10.0 tag preserved/unpublished. v0.10.1 `21ac9b3e` published with full applicable gates. [v0.10.1](../releases/release-v0.10.1.md). |
| v0.11.2 dry-run: [36110554528](https://github.com/tnfssc/die/actions/runs/36110554528); same-source CI 36110554541 green | Ledger test did 261 serial durable reservations and exceeded Bun's 5s default. Unfinished work caused subsequent active-path assertion. Seed valid full ledger setup, still use real durable eviction/reopen/replay operations. No timeout/capacity/runtime change. | Fix worker `76b2065` integrated `6a270f3`. Final dry-run 36112079204 and publication [36113061004](https://github.com/tnfssc/die/actions/runs/36113061004) passed. **Not demonstrated runtime leak.** [v0.11.2](../releases/release-v0.11.2.md). |

### v0.15.3: wrong integration tip, missing git identity, partial draft publication

1. PR **#7** introduced one-click release (merge `0a73179a`; workflow implementation `968c096c`). PR **#8** merged `bb8c1a20` but **not** reviewed fix `3e83a08`: parent pushed the wrong worktree tip. Ancestry, not merely successful push/merge, matters.
2. CI **36249818642** and Release push **36249818536** / manual **36249829897** failed `tests/manual-release.test.ts:34`: **Committer identity unknown** on annotated fixture tags. Signing was disabled but fixture lacked user.name/email. Manual prepare had made v0.15.3 commit `420d722`; these runs published no tag/assets. Fix `581870e4` sets fixture-local identity and verifies with global/system config disabled.
3. Release **[36252109334](https://github.com/tnfssc/die/actions/runs/36252109334)** then reached publish after native/updater gates. It pushed tag v0.15.3 at `a173cd28b80d2ea328d7abc03b5587b86d471e61`, and draft creation returned an untagged URL. Immediate by-tag API lookup returned 404; script threw **Release was not created** before draft publication. This was a **draft lookup bug**, not failed compilation or proof that no draft existed.
4. `80872d73` falls back to authenticated releases list after by-tag 404, preserving same-SHA and asset size/digest/exact-set verification. Earlier `40def9ea` implemented same-SHA/idempotent publication recovery. Inspected notes do **not** establish final recovery of that exact draft. Later v0.15.5 **36302402467** and v0.15.6 **36308999634** are successful later releases, not evidence that the old draft was repaired.

[Manual release investigation](../releases/manual-release-dispatch.md). The investigator had read-only credentials that could not see drafts: absence from that API view was not absence. Rerunning old failed jobs would use old `a173cd2` publication logic; changed develop also conflicts with manual publication guard.

### Cache rollout: invalid workflow, not failed release build

- Hosted **36309583195 / 36309583805** rejected workflow **before jobs**: `runner.temp` was unavailable in job-level env. A duplicate env map had already been caught locally (`RELEASE_SHA/RELEASE_TAG` preservation fix `929afb2b`), but text/parsed YAML tests missed context legality.
- Fix **02327ad4** configures store paths in a step using `RUNNER_TEMP` → `GITHUB_ENV`. Add actionlint validation; keep frozen installs and all build/tests, cache downloads only.
- Release dry-run **36309732944** passed. CI **36309732905** was **cancelled by newer push**, not a test failure. Final CI **36309940829**, attempt 2, proved same-SHA warm cache hits after `e7e92b47` moved cache action to Node24.
- Downloads dropped to zero, but Linux job 394s → 393s is noise, **not proven meaningful speedup**. v0.15.6 publication unaffected. [Cache evidence](../releases/cache-followup.md).

### v0.15.15: runner metadata mistaken for build input drift

- Old **36813685812** is referenced as a failed run; the note ties preparation to Release environment fixture fix **82cdcff**. Git diff shows ci-web fixtures now exercise inherited `DIE_T3_SOURCE` rejection, clear it only within fixture setup, then restore it. This is local source-environment isolation, **not** permission to remove the production custom-source guard. Parent Actions logs should confirm the exact old failed test.
- Fresh **[36818925498](https://github.com/tnfssc/die/actions/runs/36818925498)** at `979e032` passed deterministic tests/smoke, then first target compile failed `verifyPackedWeb`: **build inputs changed**. Publication/final artifact gates never ran.
- Runner **2.337.0** changes `GITHUB_PATH`, `GITHUB_ARTIFACTS`, `GITHUB_ARTIFACTS_LIST` command-file GUID paths each step. Producer/consumer separate steps guaranteed identity drift; these were invocation metadata, not archive/source/toolchain changes.
- Fix **c8e824d3** (worker `a418ecd`) excludes **only those exact variables** from receipt environment identity. Source/content/mode, toolchain and archive checks retained; 52 focused tests. Successful **[36820378274](https://github.com/tnfssc/die/actions/runs/36820378274)** published v0.15.15 at **7fa768783d159a4c6a79d45168fa9010b3f0022f**.

[v0.15.15](../releases/v01515-release.md), [runner contract / red-green proof](../ci/release-packed-web-command-files.md). Original failed artifacts did not contain full env snapshots/GUIDs; runner source and isolated reproduction establish cause, not an invented complete original identity diff.

### v0.15.26: premature fixture teardown and cross-test fake Git

**[37064291977](https://github.com/tnfssc/bruv/actions/runs/37064291977)** at prepared `74a636f`: 1716 pass, 20 skip, two capability-test failures and unhandled durable-write ENOENT. Pending-publication assertion assumed 100ms sufficient for fsync; fixture removed directory while publication still active. A separate controlled overlap showed sensitive Git test resuming after the next test changed PATH to fake Git (expected +changed, got late private output).

Test-only repair **a54de8f → c4dc3a8** joins serialized/idempotent durable publication, attaches rejection handling, aborts/drains before teardown, awaits rejection assertions. Real delayed-fsync and independent Git-overlap reproductions; no security assertion or runtime semantics removed. Retry **[37066171321](https://github.com/tnfssc/bruv/actions/runs/37066171321)** published same v0.15.26 at **447bdb0b6419608d0d5197ca55011a0c2830f83c**. Separate upstream migration deliberately not mixed into repair. [Release](../releases/v0.15.26-cleanup.md), [cause/proof](../releases/v0.15.26-capability-gate.md).

### v0.15.29: real disabled-fast-path regression

**37143993104** failed nine placement tests before publication. Eager routing/auth/model-endpoint inspection happened with fast mode **off**. Local reproduction; **0249ae6c** returns before those checks without enabled consent, adds throwing-getter regression. This is **product code repair**, not just fixture stabilization. Fresh **[37144547603](https://github.com/tnfssc/bruv/actions/runs/37144547603)** published v0.15.29, tag **0249ae6c1a5314011fc489476a3197f5bea9fb31**. [Fast release record](../releases/v01529-fast-mode.md).

### v0.16.0: four copied native harness portability blockers

Four unpublished attempts: **37182001166** setup assumed `/usr/bin/node`; **37182435634** second workflow invocation same assumption; **37182775259** stale packaging assertion still expected absolute path; **37183052832** child-history verifier depended on developer-only SDK cache.

Fix commits include **9622662a / 80a0ab89**: configured Node **24.21.0** drives subprocesses and isolated PATH keeps its directory; SDK **0.3.276** supplied explicitly as test-only archive with API/version preflight and recorded SHA256. Remove developer-home fallback. Clean setup and all six suites passed; no production T3 patch/gate weakening. Final **[37183737744](https://github.com/tnfssc/bruv/actions/runs/37183737744)** published v0.16.0 at **3eec281bb270f1cafa61a0de243bbd0c45e00b4f**, 20 assets. [Release](../releases/v0160-external-connector.md), [metadata](../releases/v0160-verification.json).

### v0.16.1: partitioned CI green, serial Release contaminated by SDK wrappers

PR **#26**, head CI **37188645978** green; merge **49f97347**. Release **[37188844249](https://github.com/tnfssc/bruv/actions/runs/37188844249)** at prepared `8e687ef0` failed serial tests: disk projection estimator inherited prior shake wrapper requiring full `manager.getSessionId`. Fresh/projection-only manager did not provide it. Partitioned CI did not share same installation order/process globals.

**b39d0f4e** (worker `6ce258f7`) isolates five disk-owning connector suites in fresh children; parent checked original test bodies transpile identically, no production fix/assertion change. Final **[37190223990](https://github.com/tnfssc/bruv/actions/runs/37190223990)** published v0.16.1 at **cb32e158227dad6272af9ccf6fad2731f46ec62d**, 20 assets. [Release](../releases/release-v0.16.1.md), [related provisional repair removed](../releases/codex-fast-alignment-release.md).

The alignment note cites 28 failed serial cases; the release note describes two matching failures in before/after reproduction. These are not necessarily the same measure. Treat cause/final repair as established; **use parent logs for the exact hosted failure count**. Alignment PR CI **37189627215** separately had realtime tool-reply `JSON.parse(undefined)` after fixed 10ms sleep; retained bounded observable-reply wait kept truncation/path assertions. Do not conflate with SDK-wrapper failure or ship the discarded pristine-estimator workaround.

### v0.16.4: “rollback failure” was inactive fault injection

- **[37204735419](https://github.com/tnfssc/bruv/actions/runs/37204735419)**, Mac job **111444307901**: rollback probe lacked expected nonzero exit + restoration stderr. All Linux/native/build gates passed; publish skipped. Empty stderr alone did **not** identify crash/signal/cache cause.
- **ce26adf2** adds status/signal/spawn-error/both-stream diagnostics and keeps error marker out of Bun source excerpts. Retry **[37205537711](https://github.com/tnfssc/bruv/actions/runs/37205537711)** exposed status 0, no signal/error, successful update at `/private/var/folders/...` while fault injector compared against `/var/folders/...`.
- Both current and frozen **0.16.3** updaters correctly realpath target. Noncanonical fixture strict comparison meant requested rename failure **never fired**. Linux compiled alias-TMPDIR regressions reproduced same symptom before repair.
- **dd075b0a** (worker `4764a4f9`) canonicalizes fixture install directory before generating runner; additionally requires injected-failure message. Production updater unchanged, rollback/checksum/pair restoration assertions retained.
- Final **[37206254734](https://github.com/tnfssc/bruv/actions/runs/37206254734)** passed all six jobs and published v0.16.4 at **dd075b0a9d5d9c37e386ef0a7fd3bad8b2950d48**, 20 assets, 2026-10-04T13:46:10Z. Narrative ends at pending dispatch, but durable [verification JSON](../releases/v0164-verification.json) establishes closure. [History](../releases/v0164-compact-activity.md).

## 2. Green workflow, broken shipped app / experience

### v0.12.0 web Live: acceptance scope missed user need

CI **36137088351**, dry-run **36137088409**, publication **[36138207362](https://github.com/tnfssc/die/actions/runs/36138207362)** all succeeded at **726e1ce09a612624fac03259664b629f8f412570**. v0.12.0 published 2026-09-25T13:03:43Z with 12 assets.

User then reported released web voice **did not work, looked poor and lacked model choice**, explicitly requested removal/CLI-only. Record does **not** establish one precise transport/device root cause. Fake routes, unit checks, packaging and labeled offline control screenshots were not active packaged/real-provider/device acceptance. Do not claim that they proved usable voice.

Corrective **v0.12.1** removes web route/UI/bridge and restores exact prefeature canonical patch, retaining CLI voice/costs. Real packaged probe rejects voice WS upgrade; built-file scan finds no feature markers. CI **36142805220**, dry-run **36142805236**, publication **[36144138475](https://github.com/tnfssc/die/actions/runs/36144138475)** passed at **a0da32ddd0ddfa681fa2835973c8fa9ea3094cd0**. [v0.12.0](../releases/web-live-release.md), [withdrawal](../releases/web-live-removal-release.md).

### v0.15.12 browser boot: proven bundled initialization defect

Publication **[36631518026](https://github.com/tnfssc/die/actions/runs/36631518026)** passed all then-existing gates; stable tag/SOURCE **f9428de7f69e4420adf6222ade5d46b9fd48cffc**, 12 assets. Downloaded official Linux binary checksum **6a26c1a789d6fdf37f49e78486cbd2988673575cb7f5ecd8cd9b3e23f9a2f2b5** matches published manifest.

Backend/SQLite/HTML worked, but Chromium rendered **T3 Code could not load** with Effect **TypeError: c is not a function**. Artificial Rolldown vendor/size chunk groups split a cyclic top-level initialization graph; Array called imported Function.dual before var-bound implementation initialized. **Not** missing archive files, authentication/provider, or backend boot. Single-Effect-chunk and vendor-only partial fixes exposed further schema/base-class errors and were discarded.

Fix **25688b3** removes whole artificial codeSplitting override, retaining lazy UI imports and codec/data assets. Keep honest large-chunk warning instead of under-500kB assertion that incentivized unsafe split. New static emitted graph gate catches cycles/missing dependencies in fresh and reused web builds. New final-artifact Chromium cold-boot/reload gate **3e8391c2** makes publish depend on real app/setup UI with no page/console/asset errors. Parent full build also fixed Vite worker.format literal typing.

**v0.15.13** successful dry-run **36703153676**, publication **[36704291531](https://github.com/tnfssc/die/actions/runs/36704291531)** reused exact assets and repeated browser/Mac gates, SOURCE **92efde9f0cdc1d1fdf34382dabe803f7257fa66f**. Separately a local v0.15.9 compiled binary failed the new gate with same visible error; this proves detection on that local artifact, **not independent proof its public release asset was broken**.

[Original publication](../releases/sol-v0.15.12.md), [root cause](../t3/v01512-browser-startup.md), [gate](../releases/linux-release-browser-boot-gate.md), [v0.15.13 closure](../releases/t3-boot-v0.15.13.md).

### Audio/API claims: green device-free gates are not device/provider proof

v0.8.1 responded to Ghostty/no microphone prompt despite prior SoX capture. v0.8.2 explicit mixer/output graph connection was **plausible**, not proven physical root-cause repair, despite successful **35956568739**. Do not reclassify device-free gates as acoustic/TCC/provider acceptance.

Separate v0.11.1 Realtime setup fix had real, limited evidence: omitted output PCM rate rejected `session.audio.output.format.rate`; explicit **24000** accepted `session.updated`. **aac1d2f** fixes that verified schema mismatch. This does not prove full audio/full-model acceptance or a CI packaging defect. [v0.8.1](../releases/release-v0.8.1.md), [v0.8.2](../releases/release-v0.8.2.md), [v0.11.1](../releases/release-v0.11.1.md).

## 3. Later real product defects caught by gates before shipping

The browser gate subsequently failed develop Release runs **36761523355** (job **110048362625**) and **36762688740** (job **110053095183**, `ec3ce32`): real draft-route error boundary, **[tiptap error]: The editor view is not available. Cannot access view['dom']**. Emitted instruction was controlled-selection layout effect reading `w.view.dom`; source checked only editor object existence. Upstream pinned source already contained defect, before CI speed rollout. **Separate from chunk cycles.**

Fix **c32a42b**, pushed with **9745aa1**, guards destroyed/unmounted/null editor before changing initial selection state. Deterministic actual Tiptap lifecycle regression; no sleeps/filtering/retries. Hosted full CI **36770807934** and dry-run **36770807953** passed unchanged gate. Exact failed binary passed local unchanged gate even with CPU slowdown: **natural timing trigger not locally reproduced**, but two hosted proofs/source plus deterministic lifetime tests establish invalid assumption. [Lifecycle diagnosis](../t3/composer-editor-startup-lifecycle.md).

v0.16.3 independent review also held release for false idle after failed app HTTP MCP result release. **641d8492** closes fatal transport/output failure without later result/idle/command-completed delivery, including autonomous paths; final real-peer/native gates passed. This is a pre-release product defect, not a failed hosted Release attempt. [v0.16.3](../releases/v0163-ui-only-setup.md).

## 4. Successful Release with separate red standard CI

- **v0.15.25:** Release **37014484547** passed, but CI **37014485451 / 37016177565** failed migration provenance fixtures needing historical baseline blob unavailable in shallow checkout. Release fetched full history. **37cd554** integrates CI history prerequisite repair (worker **3e6fadd**). CI policy failure downstream of Linux was not another product failure. [Release/source](../releases/v0.15.25-upstream.md).
- **v0.16.2:** Release **37191445417** succeeded, prepared/tag SHA **49379a1958ef41127799a166de8df8190f26c0f3**; PR CI **37191283260** also green. Postmerge CI **37191433942** red: `patched SDK startup: empty` exhausted **100 setImmediate turns** before grammars:ready, though grammars:start observed. Equivalent scenario passed full serial Release. Recorded next work is fixture grammar-completion synchronization preserving readiness/latency assertions; not proof of a broken shipped app. [Publication JSON](../releases/v0.16.2-publication.json).

## 5. Packaging research that must not be counted as failed hosted releases

- Single-binary candidates before v0.2.14 hit dynamic `createRequire(@ff-labs/fff-node)` lookup and Bun1.4.1/node-pty1.1.0 interactive `EAGAIN` → shell SIGHUP. Self-exec Bun interpreter/bootstrap and native Bun.Terminal PTY adapter fixed tested candidates. Short noninteractive PTY checks had missed interactive failure. Candidate failures are **not evidence an official asset shipped these defects**. [Single binary](../packaging/single-binary-packaging.md).
- Packaged WS smoke timeout was hand-built Upgrade via Bun node:http probe; backend stayed healthy, no upgrade/response emitted. Replace incompatible probe, preserve hostile-origin checks. Not same-origin product failure. [Probe fix](../packaging/packaged-probe-final-fix.md).
- Android packaging/source review found pinned fff-node lacks Android binary and guarded native index creation. No adb device; cross-build/readelf is **not Android CLI/web/native feature execution proof**. [Android audit](../packaging/android-release-review-2026-09-27.md).
- Full /tmp, long Chromium socket paths, missing worktree deps/generated assets, wrong interpreter and stale dependency symlinks are recorded setup failures; successful corrected reruns do not erase them or turn them into product bugs.

## 6. Current workflow and history implications

At inspected HEAD, Release triggers **manual workflow_dispatch or v* tag push**, not every develop push. Manual prepare requires develop, fetches latest branch/tags, rejects changed workflow since dispatch, prepares next version/notes and pushes preparation commit. Historical develop dry-runs/exact-SHA reuse were valid **then**; they are not the current trigger contract. **a65fb2d3** changed this on 2026-10-01.

Current graph: prepare → native Mac helper → full Linux/platform packaging → final Linux native pair and Mac actual updater/helper → publish. Only publish writes release; manual prepare separately writes branch. Checksums/source/legal files staged first, publisher verifies tag/source/asset set. **v0.16.x no longer bundles T3**: unchanged official external **2644** is used by all six bounded Linux native gates. The legacy job ID/artifact name `linux-browser-boot` / `release-linux-browser-boot-proof` now carries native acceptance; do not interpret its green label as the old embedded-client Chromium gate. Current connector assets are tiny POSIX sibling launchers, not the earlier eight compiled executables; 20 asset count alone does not establish same architecture.

Read workflow history: **62b27f51** initial CI/release; **cd15b040** final backend/PTY validation; **39ebe0f8** historical develop gates; **18388981 / 988f4420** exact-SHA reuse/provenance (PR **#5**, merge **aac8425e**); **968c096c / 40def9ea / 80872d73** manual/recovery/draft lookup; **02327ad4** cache contexts; **3e8391c2** real browser gate; **fd84441a / c8e824d3** packed web reuse/metadata correction; **a65fb2d3** release-only triggers; **08ad5558 / 9622662a / 80a0ab89** external2644/configured Node gates; **dd075b0a** canonical fault injection. Sample fix diffs checked against source, not just commit subjects.

### What parent Actions history should settle

- Exact old/undocumented failing stage: v0.2.4, v0.2.13 and 36813685812; don't guess from adjacent failures.
- Final state/recovery of v0.15.3 draft/tag from 36252109334 with write-authorized metadata, without mutating anything.
- Exact hosted test count/order in 37188844249; distinguish hosted totals from focused reproduction counts.
- Distinguish cancelled/superseded CI, workflow validation rejection, dry-run with intentionally skipped publish, and genuine job failure before computing failure rates.
- Don't count every standard CI failure as a failed release, or every green release as proof of voice/device/all-platform user experience.

## Wisdom / values

Added this research note only. Values unchanged: existing values already require testing shipped entry point/user path, separating observed fact from guesses, clear ownership, safe recovery and durable proof. These incidents reinforce those values; no new general principle or code change was requested.
