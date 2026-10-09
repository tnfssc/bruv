# Review the whole request

The [line pass](model-lines-voice-pass.md) ended at `1911be75`. It checked each source's voice. It did not check how the pieces read together. The model sees system text, tool names, descriptions and schemas as one budget. A shorter system prompt alone does not prove a smaller request.

## One home per fact

- `identity.md` owns the base identity. `system.md` owns shared values and judgment. Root and child framing still respect user-owned bases. Roles stay with their role assets. Wisdom stays with the root wisdom hook.
- `execute-description.md`, through `typescript/definition.ts`, owns execute's API and runtime help. Output/image limits, launch defaults, placement, snapshots, approval, jobs, questions, history and Live controls now travel with the tool on every path that exposes it.
- Removed `execute.md`, `executeReference`, `executeGuidance`, and the execute `promptSnippet`/`promptGuidelines`. The old base embedded the reference; bare Pi could get it through registered guidelines instead. Bruv's custom base skips Pi's generic tool rules. Both routes also sent the partly repeated description.
- Moved the tool-use judgment into the shared value that already owned it. Removed the repeated writing paragraph from wisdom; its exact-names point now lives in shared writing guidance. Kept worktree judgment in orchestrator roles, not API help.
- Tool names and schemas still go on the wire. No runtime text filter, fuzzy dedup, new prompt rule, placement change or upstream description edit. User text is not ours to trim.

## Paths checked

Traced `prompts.ts`, `typescript/extension.ts` and `typescript/definition.ts` through production Pi assembly. Root modes, fast/normal/orchestrator children, project/global custom bases, append text and project context keep their owners.

Live main-owner prepares the ordinary frame before a first text turn. Google connect and OpenAI session.update carry that frame and execute declaration. Setup probes use the same declaration but still deny dispatch. Bare voice with no tools has no execute help to send. Paired GPT Live has its own client-delegation instructions on a separate model, not another copy of the main agent's execute help. Host observations are data.

The native compatibility runtime uses the same loader and registered tool. Child role caps and operator-owned app worker policy stay as they were. Native task requests carry task args; they do not add a second execute prompt. Codex serialization and native compaction forward the assembled instructions and declarations. Compaction's trigger and checkpoint text have their own jobs.

Also read goal, handoff, wisdom, role, voice and compaction layers. Goal API help stays in the goal context hook, once per request. Handoff and completion text carry current state, not another API guide. No changes to arbitrary app/MCP tool descriptions or user text.

## Full combined sizes

Count is `systemPrompt + JSON.stringify(tools)`: all descriptions, names and schemas, not system text alone. Characters are JS string units; bytes are UTF-8. These are instruction-surface sizes, not whole HTTP bodies, history sizes or provider token counts. Default root mode is orchestrator.

| Path | Before chars | After chars | Saved chars | Before bytes | After bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Root | 19,136 | 15,577 | 3,559 | 19,168 | 15,607 |
| Fast child | 17,243 | 13,800 | 3,443 | 17,275 | 13,830 |
| Normal child | 17,258 | 13,815 | 3,443 | 17,290 | 13,845 |
| Orchestrator child | 17,361 | 13,918 | 3,443 | 17,393 | 13,948 |
| Custom root | 6,733 | 13,135 | -6,402 | 6,735 | 13,165 |
| Custom normal child | 5,273 | 11,791 | -6,518 | 5,275 | 11,821 |
| Live setup | 15,415 | 11,678 | 3,737 | 15,447 | 11,708 |

Root saves 18.6%. Custom paths grow on purpose: they previously skipped the reference and got only the short description. They now get the missing operational facts. No unique API fact was cut to make those paths look smaller. All captured schemas match before/after.

Production preview captures supply the root/child/custom numbers. Setup's before frame is rebuilt from exact parent assets and the captured unchanged schema; after uses the real setup factory. Captures, size script and logs stay in `.tmp/combined/`.

## Test proof and limits

The shared test helper reads system plus every declaration, with schemas alongside prose. It checks every non-heading execute line once, plus short clause anchors that catch the old parallel wording. Shared identity, values, roles and writing get once-only checks too. Security and delivery assertions keep human approval, pinned bytes, runtime placement, cancellation acknowledgement, late question replies and Live teardown facts.

Tests use real stream contexts, not just string builders: production root/child/custom preview, ordinary second turns, native compatibility root/custom/child turns, Live owner default/custom frames, Google connect, OpenAI setup frames, Codex request serialization and native compaction fetch. Goal API calls appear once in the goal-bearing request. Custom base, append and project markers stay intact.

Final focused runs: 85 prompt/Live-wire/UI tests, 21 Live-owner tests, and 29 native compatibility runtime tests pass (135 total, 0 fail). The compatibility suite also passes through its isolated parent runner. Build, typecheck, changed-code format and diff whitespace checks pass. No live provider calls. No full-suite green claim: known install-order and environment failures remain outside this task. This is focused owner/sink proof, not a capture of every possible runtime notice, history branch or external app tool.

Value 8 got a short addition: review system and declarations together; say each fact once. No new value or runtime prompt layer.

## Work stays here

Worktree: `/home/tnfssc/.bruv/worktrees/t3-6c093fbb-5442693331ce-task_bb7cd6cb`. Branch: `bruv/deduplicate-the-complete-model-request-bb7cd6cb`. Base: `1911be75`. Parent's completed worktree stays still. Local commit only; no push or PR.

`/tmp` is full. Tests use the exact owned short root `/var/tmp/cd-bb7cd6cb` through `TMPDIR`, with no ancestor Git repo. Evidence stays in this worktree. Git signing uses `TMPDIR=$PWD/.tmp/git-tmp`. No shared temp data was cleaned.
