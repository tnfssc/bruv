# What reaches the model

Current map for Pi 1.1.0. See [the sentence review](./sentence-review.md) for decisions and evidence. Older snapshots of this page described removed tools and old paths. They are history, not the current contract.

## System and tools

`src/cli.ts` selects Bruv's base. `src/prompts.ts` reads the Markdown assets and joins the owned parts. Pi adds cwd and any selected user/project/skill text. `src/agent/extension.ts` applies root or child guidance in `before_agent_start`. `src/agent/instruction-continuity.ts` keeps that frame through later turns and provider requests.

| Part | Source | When it appears |
| --- | --- | --- |
| Identity | `src/prompts/identity.md` | Bruv's ordinary base |
| Values and opinions | `src/prompts/system.md` | Bruv base, root and children |
| Workspace judgment | `src/prompts/main-orchestrator.md` | Orchestrator root or child |
| Child role | `src/prompts/{fast,normal,orchestrator}.md` | Matching child role |
| Wisdom | `src/prompts/wisdom.md`, `src/wisdom/{extension,location}.ts` | Root hook; paths use selected project settings |
| Execute help | `src/prompts/execute-description.md`, `src/typescript/{definition,extension,tool-schema}.ts` | The `execute` tool declaration |
| External tools | `src/claude-compat/{mcp,binding}.ts` | Discovered and admitted MCP tools; names, descriptions and schema help stay intact |

Execute help has one home: the tool declaration. It is not copied into system text. Its schema keeps field names, types and numeric bounds, with no second prose manual. Fast and normal roots add no extra behavioral prose. Mode markers are machine ownership markers.

A custom user base owns its frame. Bruv does not replace matching phrases inside it. Children still get their role. Append text, AGENTS.md, skills and extension text keep their source and wording. Repeated user text stays repeated. The native connector follows the same assembly through `src/claude-compat/runtime.ts`.

## Messages and results

| Route | Producers | Owned text and preserved data |
| --- | --- | --- |
| Execute result | `src/typescript/{execution,extension,images,output-capture,error-diagnostic}.ts` | Status, image/size/loss notices and handoff wrapper. Code, stdout/stderr, thrown user values and image bytes remain data. |
| Jobs | `src/tasks/{job-service,job-attention,completion-notification,agent-progress,agent-session,task-manager}.ts` | Launch, attention, completion and failure labels. IDs, commands, progress, child replies and saved paths stay intact. |
| Background handoff | `src/prompts/background-handoff.md`, `src/prompts.ts` | Running job IDs only. Execute help owns later delivery semantics. |
| Remote jobs | `src/remote/{jobs,job-observations,operations,question-bridge,source-approval,services}.ts`, `src/agent/extension.ts` | Launch/approval/recovery/stop state and completion notices. Remote replies, paths and captured file bytes stay data. |
| Human remote reports | `src/remote/{extension,human-rendering}.ts` | `/remote` publishes with `pi.sendMessage`. These reports enter later model history even though they are also human UI. Pure menus and widgets do not. |
| Saved questions | `src/questions/{runtime,service}.ts`, `src/remote/runtime.ts` | Saved-answer wrapper, state and errors. Question/choice/reply/checkpoint text is caller or human data. |
| Goals | `src/goals/{extension,store}.ts`, `src/prompts/{goal,goal-continuation}.md` | Conditional API guidance, state labels and continuation. Objective, criteria, constraints and evidence stay verbatim. No goal prose in the ordinary system prefix. |
| History | `src/history/{service,session-manager,disk-entry-store,shake-record}.ts` | Bounds, provenance and errors. Retrieved text remains original branch data. |
| Native task projection | `src/claude-compat/{task-binding,task-projection,history}.ts`, `src/t3/tasks/*.ts` | Tool receipts, launch markers and truncation notices. External task content stays intact. |

Helper validation and runtime errors can reach a model through tool results. They count as prose too. Most already name the field and failure in a few words. Exact codes, IDs, enum values, paths and the SDK-recognized async launch marker keep their spelling.

A stop request, owner acknowledgement and observed task end are separate facts. Saved state is not a live check. `remote.status()` reads the local saved backend state; `/remote sync` contacts the pinned owner. Failed or unknown submission is no proof of a completed action.

## Live and voice handoff

Direct Google Live (`src/live/session.ts`) and OpenAI Realtime (`src/live/openai-session.ts`) use the main owner's effective instructions and selected tool declaration. `src/live/main-owner.ts` builds that frame, projects branch history, and labels missing images, partial context and tool output. `src/live/tool-result.ts` preserves artifact paths when the inline result is too large.

GPT Live (`src/live/gpt-live-session.ts`) has its own `src/prompts/gpt-live.md`: speech and delegation, no direct function tools. `src/live/{gpt-live-context,gpt-live-delegation,extension}.ts` adds quoted observations, request state and completion/failure feedback. That separate request needs its own voice/job-stop distinction.

`src/session/host.ts` hands captured voice text to the coding agent. It labels quoted history, the latest request, omitted entries, snapshot format/path, branch scope and unknown completeness. `src/session/transcript-snapshots.ts` owns retained files and storage errors. `src/live/passive-history.ts` labels provisional or incomplete text. Historical parser prefixes stay exact; they are stripped, not emitted as new prose.

Native audio helper diagnostics are reduced to a generic message plus safe code by `src/live/audio.ts`. Raw C/Swift helper prose is not a model input source. Human device setup, consent and status displays stay human UI. `src/live/setup-probe.ts` uses the ordinary identity and execute schema, with a denied no-work result.

Paid study scripts also send authored instructions. `scripts/live/{probe-capability,probe-controlled,probe-recorded,probe-startup-audio,startup-fixture,study-trial}.ts` are in the review. Their authored direction and mock-result wrappers use the same voice. Recorded roots, transcripts, multilingual user stimuli, fixed spoken words and deliberately false prior-assistant replies remain study data. Instructions changed, so their hashes differ from older trials. Do not treat old and new trials as identical conditions.

## Compaction and auxiliary calls

`src/agent/cache-affine-compaction.ts` reuses the current complete system, tool loadout and transformed conversation. It adds `src/prompts/compaction.md` as the final user message. `User focus:` labels the supplied focus without rewriting it. The summary is model output. `src/prompts/compaction-jobs.md` adds running-job facts at checkpoint time.

`src/agent/native-compaction.ts` sends a provider-native compaction trigger using the captured payload. No textual summary instruction is added. The label in `src/prompts/native-compaction.md` is for display; replay uses the opaque provider item and separate runtime job state. Damaged or incompatible checkpoints block the request. Native-fast guards add tier/auth checks and failure text, not another system prompt.

`src/claude-compat/runtime.ts` uses a separate, transient, tool-free session for auxiliary JSON requests. Its base is `Answer user request.` The user request is followed by `Only JSON. Match this schema:` and the supplied schema. The caller's title/task request and schema remain data.

## External ownership

These sources are explicitly outside prose rewriting:

- User messages, custom system/append files, project instructions, loaded skills and caller-provided task/goal/question/focus text.
- Provider or SDK prose, tool descriptions/schema help, generated summaries, model replies and opaque checkpoint bytes. The bare-SDK regression fixtures deliberately include upstream built-in tools; ordinary Bruv exposes execute plus admitted external tools.
- Shell/process output, third-party errors, MCP results, remote file contents and retained conversation text. Bruv's surrounding labels and errors are reviewed separately.
- Synthetic user/history/provider data in tests and studies. The words are the input under test. They are not a second product instruction source.

No prose filter runs over outside text. The upstream Anthropic converter still loses root schema fields; see [the recorded limit](./all-instruction-surfaces.md#proof-and-limits). Provenance comes from message roles, tool identity, branch/ref metadata, saved question ownership and explicit quoted-history wrappers. Ordinary file reads may expose any repository text; that text remains file data.

## Inspect again

Use `bun run prompt:preview` for root/child/mode and optional paused-goal assembly. Use the tests under `tests/prompts/`, `tests/claude-compat/`, `tests/live/` and `tests/agent/` for later turns, tool results, saved replies, Live and compaction. Selected tests accept `BRUV_REQUEST_CAPTURE_DIR` to save offline request bodies. Read the complete frame, including tools, before changing wording. A passed test shows delivery or a contract, not good writing or model judgment.
