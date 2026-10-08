# PR45 merged compiled product use

## Verdict and scope
**PASS for this bounded merged-product acceptance; no product defect or blocking bug observed.** This is runtime/rendered evidence, not a fresh whole-repo readability verdict. Reviewed history/Fast/workload ownership receipts remain their existing bounded judgments. Green checks do not replace actual-code quality judgment.

Evidence root: `/var/tmp/bruv-pr45-merged-use-BY18hE` (retained; no cleanup). Source target: `48b4a44a49ca2f6d817451e47cd40b757deb2642`, parents `e6b4981930cd7e6799355c79dc05e272aec0ae75` and `c15fd2b064997daed81258461334cb8f9bde0626`. A git archive of that target populated the new evidence-owned project. Original task/worktrees and prior harness artifacts were not edited. Final working-tree status is clean and HEAD/parents unchanged. No source patch, push, merge or release.

Actual validating worker model **openai-codex/gpt-6.1-sol**, verified from this session's model_change record (2026-10-08T17:43:02.657Z, event 2b607fe6); exact record retained in worker-model-evidence.json. The app's test provider is a separate synthetic model, not this worker model.

## Current artifacts
- Main: `/var/tmp/bruv-pr45-merged-use-BY18hE/project/dist/bruv`, **92,476,896 bytes**, SHA-256 **2016f514b420ee449c3a8eaba5496f05a954cddc30d229bc29bdf7fef4ef1ef1**.
- Connector: sibling `bruv-claude-compat`, **1,816 bytes**, SHA-256 **55b58718cdfb8f87e7a947b8e67ec4911bf6fb60cb33d2acfe72f67a39d96246**.
- Main --version: **0.16.19**. Connector --version intentionally reports **Bruv connector** (no semver); --bruv-version reports **bruv-claude-compat 0.16.19**. Both --help commands exit 0.
- Package uses all four Pi **1.1.0** pins. Previous 0.16.18 artifacts were only harness references, not current proof.
- Binary hashes unchanged after all exercises (binary-manifest.json, final-verification.json).

## Safety and exact commands
Read values.md, pr45-develop-conflict-resolution.md, original-intent follow-up, focused history/Fast/workload acceptance, Pi 1.1 upgrade/recovery/recurring-drift notes and orchestration-as-tool. Inspected package scripts, build-pair/build-claude-compat/build, prepare-assets, strict host recovery, pi-host/update test fixtures and their cleanup, and retained harnesses before running.

Build/install/typecheck/test commands run through run.py, which supplies only environment.json and switches to the newly archived project. HOME/config/SDK/cache/temp are newly acquired retained paths. No inherited credentials, auth or provider configuration is forwarded. Bun is `/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun`. Exact argv/cwd/env/exit/timing for each command are in logs/*.json; full output in logs/*.txt. Scripts themselves are retained. Some initial outer launcher commands started from the worker task directory; their subprocesses always used the evidence-owned cwd/env, and no script operated on that checkout. Subsequent harness invocations explicitly cd to the new evidence directory.

Commands (cwd `/var/tmp/bruv-pr45-merged-use-BY18hE/project`, cleared environment.json):
1. bun install --frozen-lockfile --ignore-scripts --backend copy --cache-dir /var/tmp/bruv-pr45-merged-use-BY18hE/cache/bun — exit 0.
2. bun run prepare:assets — exit 0 through normal production strict entrypoint; **no recovery notice**, bypass, historical hashes, manual asset copy or fabricated generated assets.
3. bun run build -- --outfile=/var/tmp/bruv-pr45-merged-use-BY18hE/bin/bruv — exit 0; production paired build. Then rename the two real compiled outputs into the new archived project's dist/ for unchanged compiled-host tests; no rebuild/substitution or generated-asset copying.
4. bun x --no-install tsc --noEmit — exit 0.
5. bun test tests/pi-host.test.ts tests/update.test.ts — **64 pass, 0 fail, 550 expectations**, including source/compiled removed-built-in refusal, no configured MCP startup, user-authored extension registration, and both private compiled updater cases. No deadline/assertion/gate changes.
6. Main and connector --version/--help, connector --bruv-version — all exit 0.

Host fixtures delete only their acquired mkdtemp directories in existing test hooks. Updater ordinary fixture cleanup likewise owns acquired targets; its two compiler fixtures intentionally remain at /var/tmp/bruv-compiled-fixture-63WepC and /var/tmp/bruv-update-compiled-S0thT1 (retained-focused-fixtures.json). No test internals modified to change cleanup. Updater downloads are stubbed release fixtures, not a real installed-binary update. Recovery code can acquire/delete its own isolated stage on stale-source failure, but that path was **not invoked** here; clean preparation is not contaminated-install recovery proof.

No sudo, shell deletion/cleanup traps, broad kill, inherited HOME/config/SDK writes, real credential/auth/provider/SSH/device flow, old-parent data recovery, strict guard weakening, full repository suite or resource workload.

## Actual compiled conversation and rendered proof
Copied provider.py/launch.py from the retained TUI proof into tui/ and added an owned exercise.py. Provider binds only 127.0.0.1 with an ephemeral port, logs actual requests; synthetic credentials only. Private tmux socket/config, 112×35. Product invocations and env/cwd are retained in tui/artifacts/*-invocation.json, and terminal commands in tui/terminal-commands.ndjson.

- Typed first and second user turns through the real PTY. Actual screens showed SYNTHETIC_FIRST_ANSWER and SYNTHETIC_SECOND_ANSWER, retaining amber-orbit.
- /status rendered; /quit exited 0 (PID 1662037).
- Fresh compiled process reopened the actual saved session. **06-reopened.txt** visibly shows both prior user/assistant turns, not a reconstructed UI.
- Typed a continuation. **07-continued.txt** shows restored conversation plus new user text and SYNTHETIC_RESUMED_ANSWER. Actual third HTTP request includes both prior answers. /quit exited 0 (PID 1662122).
- Text, ANSI and scrollback captures, real requests and canonical saved history retained. Three HTTP requests; no claim about model reasoning or live service connectivity.

## Real execute, async jobs, persistence and connector resume
Copied/adapted use-final.py into tools/use.py; only harness invocation composition changed to also run main RPC. Copied resume-connector.py; did not mutate originals or test internals. Product cwd/env/input/output/error/PID/exit all retained under tools/main and tools/connector-final. The connector user envelopes include parent_tool_use_id:null and valid UUIDs (05872e2c-749c-4fb8-912e-66c28d059c13; resume cb0da9eb-8682-4ec3-a532-9ded4ed006cb). No earlier malformed custom-envelope attempt was repeated or counted.

Both actual entrypoints:
- Executed real functions.execute code reading owned fixture.txt and writing actual-execute.txt; file contains **OWNED FIXTURE: APPLE PEAR PLUM**.
- Real async shell launched with waitSeconds:0, completed with exitCode:0 and output of that actual file (main task_d2a380db; connector task_e80894d1).
- Second real shell launched, jobs.stop requested cancellation, then inspect observed **killed**, empty output, user-stop termination (main task_0fb484cd; connector task_a9a13007). The intermediate stop report still said running; only subsequent terminal observation counts as stopped. SHOULD_NOT_RUN did not execute.
- Tool result frames show execution exit 0, isError:false, actual stdout and both lifecycle observations. Main and connector exit 0 on stdin EOF.
- Canonical session **toolResult** records independently contain real execution output; selected originals retained in main-persisted-execution.json and connector-persisted-execution.json. Provider requests include actual tool results; synthetic completion markers alone are not treated as proof.

Fresh main RPC get_messages restored real fixture/completed/cancelled output (replay/rpc-stdout.jsonl; exit 0). Fresh TUI replay renders **1 tool called · 1 cancelled**, assistant result and job notification (replay/artifacts/reopened.txt). Ctrl+O actually expands the persisted execute code and output, including PR45_TOOL_PROOF and completed exitCode:0/file output (expanded.txt and .ansi); this is the shipped renderer, not synthetic re-rendering. Natural /quit exits 0 (PID 1665752).

Fresh connector --resume **dffbf91e-cfac-4a7e-86c1-9e4fde01b2d2** accepted initialization and valid user envelope, exited 0 (PID 1664507). Actual new loopback request contains the persisted tool role result and both lifecycle observations. Invocations/frames/results retained in tools/connector-resume-*; seven total tool-provider HTTP requests across initial main, connector and resumed connector.

## Teardown, limits and handoff
All harness jobs completed. PTY products quit naturally; private tmux servers stopped through only their acquired socket. The owned standalone TUI provider was terminated/waited; embedded providers shutdown/closed. Exact main/connector/replay/resume product and shell task PIDs are absent from /proc (final-verification.json). No broad process kill or evidence deletion.

Unverified: real provider/auth/native-subagent connectivity; SSH/remote placement; real device/voice; external SDK/T3 integration; actual contaminated-install recovery; full CI/repository tests; large history/model-context/resource budgets; release or publication. Synthetic deterministic endpoints establish real transport, tool execution, persistence and visible compiled interaction, not live-model quality. No fresh whole-repo code-quality certification is implied.

No blocker to this scoped validation, so no source patch requested. Parent retains changed-scope quality judgment and further acceptance/publication decisions. Report is outside finished source worktrees; wisdom/values unchanged because existing ownership, actual-product proof and honest-limits guidance already applies.

### Diagnostic attempt accounting
No product test/build/harness run failed. Some read-only harness/setup diagnostics failed before useful execution: an execute variable was not available in a later call (ReferenceError), shell grep syntax/glob expansion and find -exec quoting were rejected. They were replaced by direct JS file reads or corrected bounded commands, not product/source fixes. Exact attempts and outputs remain in the owning native session and execute artifacts: /home/tnfssc/.bruv/agent/native-sessions/2026-10-08T17-43-02-307Z_01a11c9c-85a3-70c8-a899-0794e2222329.jsonl. Initial outer-launch cwd qualification above is an explicit procedural limit, not a claim that every outer shell started in the evidence root.
