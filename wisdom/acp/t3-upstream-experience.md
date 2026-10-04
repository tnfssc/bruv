# Unmodified upstream T3 ACP experience (2026-10-03)

**Decision: keep release/replacement/implementation on HOLD.** Research only; no Bruv runtime change, release, push, shared source edit or build overwrite. Read `wisdom/values.md` and relevant upstream-first/main-v2/nightly integration notes. Values unchanged: existing upstream ownership, isolated experiments and honest real-path proof apply.

## Final proof status

The clean follow-up at the end of this note supersedes the initial trial’s rendered-flow limitations: completed responses, next prompt, real Stop/cancel and browser reload passed with the labeled fixture. Initial table rows document the earlier trial; backend restart, real Bruv, auth/model switching, tools and approvals remain unproved.

## Answer and exact pins

T3 is an ACP **client/host** which launches ACP **agent** subprocesses over stdio JSON-RPC. Connecting Bruv would require Bruv to provide the **agent** role. “Any ACP-supported client” is the opposite direction; T3 is not a generic agent endpoint to which other ACP clients connect.

- Latest stable GitHub release and npm latest observed at research start: **v0.0.45**, published **2026-10-02T18:17:31Z**, commit **6c8fed35dded9ff71c5b46807125457acbb76be6**. Stable source has tailored Grok/Antigravity ACP integration, **not** the generic ACP Registry driver/settings. Do not promise generic agents on stable.
- Latest npm nightly observed: **0.0.46-nightly.20261003.2623**, tag resolves directly to **fed41fa88bb27cb4325cb208d571393850bc63c2**. This is the generic-ACP revision researched and actually run. npm preview was 0.0.46-preview.20261002.2598; not run.
- Sources downloaded fresh from GitHub into the owned research cache. **Never used** the PATCHED `.cache/bruv-t3code-fed41fa88bb27cb4325cb208d571393850bc63c2` as upstream.
- Actual executable: unmodified npm platform archive `@t3code/t3-linux-x64@0.0.46-nightly.20261003.2623`, unpacked without dependency installation/building; binary SHA256 **2cc42990ee8ad2ff30bbd43cdcf67686c9ca5aaff5e3ed36b5be40962cc53795**. Archive SHA256 **e151acec4b4b38b6b41352a973c8228ce53f41c8973b6f9532066b8400631445**.

**Not truly arbitrary registration:** nightly exposes official ACP Registry search or “Enter manually”, but manual entry means an **official registry ID**, executable override and auth-method override. Catalog lookup and compatible-distribution selection happen before executable override; an unknown agent ID remains not_found. No supported arbitrary command+args definition or configurable registry URL is exposed in normal settings. Registry args/env still apply to executable overrides. Thus registry-backed agents work in principle; an unregistered Bruv agent cannot simply be added as “bruv” with a path. Borrowing another registry ID is a research fixture expedient, not a recommended product integration. No registry-cache mutation was used.

## Capabilities: distinguish source from execution

| Area | Verified current upstream behavior | Evidence level / limits |
|---|---|---|
| Registration | Settings → Providers → Add provider; official registry search, compatible distributions (binary/npx/uvx); identity/instance label and per-instance environment variables; manual official ID and executable/auth override | Actual Chromium setup flow; saved research-fixture instance. Registry search showed first 20 compatible results, not total catalog size. |
| Installation | Prepares/downloads binaries or installs npm/uv packages; override avoids installing agent distribution. Runner/platform requirements checked | Source only for maintained-agent installation. Package preparation may install global packages; isolate before a real-agent trial. |
| Authentication | initialize discovers methods; agent-managed authenticate (on auth-required session creation), terminal auth, env-var setup and URL auth paths; configured authMethodId must match advertised method. Terminal/env auth cannot run as agent-managed auth inside headless session | Source plus visible sign-in screen. No real provider credentials/auth success tested. Fixture advertised no methods. |
| Models/options | Probe discovers models/config options, Default fallback, custom models and generic composer controls; session model/config/mode RPCs supported | Fixture returned two legacy models and Ask/Code modes; actual composer displayed Default and Ask. **No real model switch proven**, and legacy models did not establish full picker discovery in this run. Prefer current session config-options contract for later proof. |
| Sessions | session/new with cwd and MCP servers; session/load when advertised, otherwise session/resume if advertised, otherwise clear method-not-supported error; list/import/delete/logout/provider configuration capability-gated | Actual session/new and two separate prompt sessions; rest source-only. No load/list/import/delete/restart acceptance. |
| Stream | session/prompt; session/update chunks, tool-call/activity and config updates translated into T3 events; prompt stopReason closes turn | **Real protocol proof**: initialize → new → prompt → agent_message_chunk updates → end_turn twice. Client initialize requested protocolVersion 2; fixture answered 1 and was accepted. Not a general compatibility claim. |
| Cancel | session/cancel notification; runtime has wait-for-prompt/interrupt handling and bounded timeout/retirement paths; ACP adapter has interrupt/quarantine semantics | Source-only. Attempted long-turn UI test did **not** produce session/cancel; fixture eventually returned end_turn. Do not claim Stop acceptance. |
| Reconnect | Browser transports and persisted T3 history differ from reattaching an ACP subprocess; saved ACP ID requires advertised load/resume support. Losing a subprocess is not transparent stateless reconnect | Source capability path only; no agent crash/backend restart/route recovery acceptance. |
| Client services | initialize advertises terminal/form/URL elicitation and conditional filesystem services; injected T3 MCP server and T3 instructions appear in new/prompt | Actual wire captured MCP server and sizeable instructions. Fixture never consumed MCP or requested client services. Other workers own orchestration/MCP ownership. |

Source anchors at pinned nightly (all inside fresh source-nightly):
- packages/contracts/src/settings.ts:872–917 (official ID, executable override, auth, distribution).
- apps/server/src/provider/acp/AcpRegistrySupport.ts:1613+ and 1700+ (catalog/distribution before override; spawn args/env); registry URL constant is https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json.
- apps/server/src/provider/Drivers/AcpRegistryDriver.ts (readiness/models); acp/AcpRegistryProbe.ts (auth/config/session capability discovery).
- apps/server/src/provider/acp/AcpSessionRuntime.ts:2157+, 2210–2330, 2431–2475 (initialize/auth/new/load/resume/cancel).
- apps/server/src/orchestration-v2/Adapters/AcpAdapterV2.ts and AcpRegistryAdapterV2.ts (actual V2 adaptation/client capabilities).
- apps/web/src/components/settings/AddProviderInstanceDialog.tsx, AcpRegistrySearchStep.tsx, AcpSessionManagementSection.tsx (rendered flows).

## Actual bounded trial and honest experience

Owned artifacts: **.cache/acp-t3-upstream-experience/**. Source snapshots, original npm archive, registry response/hash, releases/tag/npm metadata, CLI help, scripts, logs, protocol trace and screenshots are there. Cache includes temporary local pairing/browser cookies: do not publish wholesale.

Ran upstream platform executable on loopback :18764 with a separate home/project, and real headless Chromium. Fixture `fixture.mjs` is a **minimal research-only JSON-RPC ACP agent**, **not Bruv**, not a maintained paid agent and not evidence for Bruv implementation. Registered it through actual UI as registry ID **gemini** plus executable override; registry contributes **--acp**, which fixture ignores. Official Gemini registry entry was 0.62.0 / @google/gemini-cli@0.62.0, but **Gemini itself was not installed/run**.

Observed: pairing gate and one-time token; Add provider registry/manual/identity/sign-in flow; provider persisted with driver acpRegistry and selected executable; two actual T3-to-fixture initialize/new/prompt exchanges and fixture chunk/end_turn responses (protocol-summary.json, fixture-protocol.ndjson). Fixture initial syntax error was repaired; its first completed turn echoed injected instructions, later fixture narrowed echo to user_request. These were research-fixture defects, not upstream patches.

UI was **not** clean end-to-end acceptance: initial broken fixture left a “could not create a test session” warning; submit snapshots showed Working/Thinking; later composer displayed Ask; reopening title reached correct environment/thread route but capture was still Loading messages. Sidebar text clicking was intercepted by list layout and needed a forced button click in automation. No rendered completed assistant transcript/Stop/reload proof claimed. Startup/submit were slow in this environment; logs show event-loop stalls and checkpoint baseline failure when scratch project initially inherited parent Git repository. Initialized an owned empty Git project afterward. Do not attribute all slowness to ACP. Do not use source hashes or wire completion as a substitute for UX approval.

npm issue also observed: initial t3 launcher did start, but its optional platform package was absent after adding browser tooling to that runtime (pruning is the likely cause, not independently established); explicit npm platform install then failed on bundled musl dependency vs glibc. Fresh official platform archive extraction provided the runnable unmodified executable and its web assets. First failed browser boot was Not Found before fresh platform extraction; not evidence that properly unpacked upstream lacks its UI.

Server had a bounded 12-minute deadline, ended with SIGTERM; final process check found no owned upstream/fixture processes. No global agent installation or real-provider call made.

## Concrete setup / commands

Usual upstream setup (not a maintained-agent success claim):
```sh
npx --yes t3@0.0.46-nightly.20261003.2623 start --no-browser --host 127.0.0.1 --port 18764 --base-dir /absolute/isolated-t3-home
# Open printed pairing URL. Settings > Providers > Add provider > choose registry agent.
# Prepare/sign in as UI requests; registry selects distribution. CLI has no generic add-ACP command.
# For local executable override: Enter manually > official ID > absolute executable > identity > sign-in.
# Registry arguments/environment still apply; arbitrary args are not a normal field.
```

Exact acquisition/trial recipe (repo root; artifacts only):
```sh
R=.cache/acp-t3-upstream-experience
mkdir -p "$R"
gh api repos/pingdotgg/t3code/releases/latest --jq '{tag_name,published_at,target_commitish,html_url}'
npm view t3 version dist-tags repository --json
gh api repos/pingdotgg/t3code/git/ref/tags/v0.0.46-nightly.20261003.2623
curl -fLsS https://api.github.com/repos/pingdotgg/t3code/tarball/fed41fa88bb27cb4325cb208d571393850bc63c2 -o "$R/upstream-nightly.tar.gz"
curl -fLsS https://api.github.com/repos/pingdotgg/t3code/tarball/6c8fed35dded9ff71c5b46807125457acbb76be6 -o "$R/upstream-stable.tar.gz"
mkdir -p "$R/source-nightly" "$R/source-stable"
tar -xzf "$R/upstream-nightly.tar.gz" --strip-components=1 -C "$R/source-nightly"
tar -xzf "$R/upstream-stable.tar.gz" --strip-components=1 -C "$R/source-stable"
curl -fLsS https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json -o "$R/registry.json"
curl -fLsS https://registry.npmjs.org/@t3code/t3-linux-x64/-/t3-linux-x64-0.0.46-nightly.20261003.2623.tgz -o "$R/t3-linux-x64.tgz"
mkdir -p "$R/platform" "$R/project" "$R/home"
tar -xzf "$R/t3-linux-x64.tgz" --strip-components=1 -C "$R/platform"
(cd "$R/runtime" && npm install --no-audit --no-fund t3@0.0.46-nightly.20261003.2623 playwright)
# This runtime's npm platform dependency installation failed/pruned; archive executable below avoids it.
(cd "$R/project" && ../platform/t3 start --host 127.0.0.1 --port 18764 --no-browser --base-dir "$PWD/../home" --auto-bootstrap-project-from-cwd > ../server.log 2>&1)
# New token if prior one consumed; do not reuse recorded credentials:
"$R/platform/t3" pair --base-dir "$PWD/$R/home"
chmod +x "$R/fixture.mjs"
node --check "$R/fixture.mjs"
node "$R/browser.mjs" "$R/settings.js"   # recorded actual manual/identity/sign-in actions
node "$R/browser.mjs" "$R/prompt.js"     # recorded submit
node "$R/browser.mjs" "$R/cancel.js"     # attempted long turn, NOT Stop acceptance
node "$R/browser.mjs" "$R/final-observe.js"
```
Browser harness uses existing Chromium /home/tnfssc/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome, 1400×950 headless, --no-sandbox. Actions are saved separately; pairing scripts contain expired research tokens. protocol-summary.json is the small readable evidence; full trace includes injected T3 instructions.

## Still needs Bruv ACP before a replacement decision

1. Decide supported registration path: official registry listing vs upstream-supported custom registration. Existing-agent executable override is not honest permanent Bruv registration.
2. Run **real Bruv ACP agent** against this exact unmodified nightly (then stable once support releases), prove auth/advertised capabilities and config/model switches; do not count this fixture.
3. Prove visible text/thought/tools/errors, approvals/questions, model/session state, Stop/cancel acknowledgement, subsequent prompt, list/load/import and process/browser/backend reconnect with preserved transcript. Include real credentials only in isolated approved test state.
4. Confirm advertised protocol version 2/current config-options semantics, media/tool/terminal/file behavior and agent-specific extensions against Bruv's intended subset.
5. Other workers decide native orchestration/MCP ownership and Bruv feasibility. This study proves a registry-backed host path, **not** parity with bundled Bruv integration or readiness to replace it.


## Clean follow-up: actual rendered acceptance (2026-10-03)

**PASS for the explicitly labeled research fixture, not Bruv or Gemini.** One fresh server/browser run, bounded Chromium harness (8-minute observation window), no upstream/product edits. Artifacts: **.cache/acp-t3-clean-followup/**; start with **RESULT.json**. Reused exact unmodified Linux x64 nightly above: executable SHA-256 **2cc42990ee8ad2ff30bbd43cdcf67686c9ca5aaff5e3ed36b5be40962cc53795**, independently matched against `package/t3` in the original npm archive. Fresh base-dir; owned independent project Git repository initialized and committed **before launch**, clean afterwards. Actual Chromium 1243, 1400×950, loopback :18765.

Corrected minimal fixture uses unique session IDs, fixed short deterministic text, 800ms completion / bounded 30s cancellable turn, no invented load/list/resume capability. UI registered registry **gemini** + fixture executable override as **Clean Research ACP Fixture (not Bruv)**. Initial manual setup reported **“No valid cached ACP Registry index is available.”** Opening the actual official catalog populated its cache; provider refresh then reported Available. Registry SHA-256 remained **ed1d14c501ded7f453b227994194dd258a9969ce20cc873ce0932cd7458d33dc**. No backend restart, source patch, or custom registry entry. Harness selector/navigation errors are recorded separately, not agent failures.

Actual proof:
- **19-result.json / 19-screenshot.png:** visible **RESEARCH_FIRST_COMPLETE**, no Working indicator, composer restored. The earlier 8-second action snapshot still showed Working/Thinking; a subsequent bounded observation rendered the completed response and transitioned from draft to saved thread. This was not instant UI acceptance.
- **20-result.json / 20-screenshot.png:** same thread accepted next prompt and visibly rendered **RESEARCH_SECOND_COMPLETE**.
- **21-result.json / 21-screenshot.png:** real Stop click produced wire **session/cancel**, fixture **RESEARCH_CANCEL_ACK** and prompt result **stopReason: cancelled**; UI displayed **“Run interrupted · Run interrupted by user”**, with composer back.
- **22-result.json / 22-screenshot.png:** actual browser reload retained both completed responses and cancellation text/status. Assertions checked all markers, visible composer and no Working; final check found no Stop control.
- **protocol-summary.json / projection-summary.json:** read-only DB inspection agrees: run statuses **completed, completed, interrupted**; persisted assistant text non-streaming, provider session ready. Wire requested protocol 2 / fixture answered 1, as before; not broad version compatibility proof.

Residual errors were saved, not attributed to ACP without evidence: no browser page exception; Clerk returned HTTP 400 with **“Production Keys are only allowed for domain t3.codes”** / origin mismatch; local observability trace requests aborted. Backend logged missing Claude CLI, unknown source-control provider PR lookup (owned repo has no remote), and event-loop stalls including 7154ms. These did **not** prevent this transcript acceptance. Prior broken fixture/parent Git/stale-state causes remain plausible, not individually proven by this combined clean run.

Cleanup verified browser exit, server SIGTERM completion, no :18765 listener or owned fixture/browser process. Removed temporary base-dir authentication/runtime state, browser cookies and setup screenshots; retained credential-free transcript screenshots and private research traces. A fresh T3 base-dir still discovers installed bundled-provider auth/status outside it; that is not fixture evidence. **Do not publish the full cache.** No backend restart, agent crash recovery, session load/import, tool/approval/model-switch or real Bruv acceptance was tested; original replacement gates still apply.
