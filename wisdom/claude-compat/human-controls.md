# Native Bruv human controls

Implemented adapter, 2026-10-03. Local code + deterministic proof, not native-browser acceptance. See [feature parity](feature-parity-plan.md), [binary contract](binary-contract.md) and [task UI contract](task-ui-contract.md).

## Frozen binding API

- `createClaudeCompatHumanControls({ request, askUserQuestion?, diagnostic? })` in `src/claude-compat/human-controls.ts` returns `factory`, `openQuestion(id, signal?)`, `dispose()`, `questions()` and live `capabilities`.
- Bind `request: transport.request.bind(transport)` to the SAME transport. Include `human.factory` in the owning runtime's extension factories alongside Bruv's extension. Default native T3 AskUserQuestion support is true; pass false for a host without that callback. No UI context or hasUI flag is fabricated.
- `createClaudeCompatCommands({ session, notify, humanControls: human })` takes the actual AgentSession after creation. `catalog()` supplies namespaced controls that really exist. Merge this catalog into initialize's commands. Call `dispatchUserCommand(nativeUserFrame)` only at validated root human user-frame admission, before steer/prompt. False means ordinary input; true means do not call the model. Errors must become visible human command errors, never fallback prompts. `notify` must render an operation result through the existing native frontend, not a new model turn. This adapter does not own result framing or the output queue.

Runtime owner task_1c3b7533's current runtime.ts exposes actual session, creates inline factories before createAgentSession, advertises commands in initialize, and admits user frames before session.steer/prompt. Its frontend.ts captures ExtensionContext at session_start and has the existing output queue. Those files were inspected, not edited. Parent integration must add the factory/catalog/admission call and human-result rendering there. No second AgentSession, scheduler, HTTP server or control plane is needed.

## Ledger and callback ownership

The only shared changes are an explicit parent-only native lease on registerQuestionRuntime and one nativeSupported: () => subagentDepth === 0 option in the existing Bruv extension. Normal CLI supported() behavior, picker and reply queue remain unchanged. Children do not get native question authority.

The adapter gets the existing command port over the extension event bus. It does not instantiate QuestionService or write another ledger. questions.ask still saves and returns without waiting for a dialog. A subscribed projection sends can_use_tool with tool_name AskUserQuestion, actual question text/options and tool_use_id derived from saved ID/version. Official T3 ClaudeAdapterV2 maps question text to its answer ID and returns updatedInput.answers[question.text]. That exact correlated value, not assistant prose, goes to the trusted command route with captured owner/version. Ledger choices/free-text constraints still apply. Native UI cannot promise the same constrained free-text/picker behavior as the TUI; invalid values stay pending.

Allow without that answer is not an answer. Denial, interruption and EOF do not answer, cancel or resolve the record. A changed saved version cancels the obsolete projection and shows the current one; this matters for normal ask-then-block. Denial at the same version does not auto-reprompt. Repeat ask uses existing ledger dedup. openQuestion reopens the same saved full ID and coalesces an already live projection. A new frontend lists pending records; answered history is never replayed as a new answer.

Saving, queueing, delivery and use are different. The existing question runtime owns the bounded follow-up queue and durable claim before sendMessage. This adapter adds no continuation loop. A recovered question's reply is saved as resume-needed; the human uses /bruv questions resume <id>. Dispatching/delivered uncertainty stays fenced by the existing runtime. The agent marks use with questions.resolve and current owner/version. A second resolve fails.

## Human commands and honest missing surfaces

/bruv goal, /bruv mode and /bruv questions call actual registered extension handlers with the real command context and RPC mode. Only notifications are projected; no fake modal/editor/picker API. /bruv:goal etc. are equivalent forms. Ordinary CLI commands stay untouched. Non-user frames are not dispatched. Keep this function out of model tools and worker outputs.

/bruv status reads actual session/model/stats because ordinary /status toggles a TUI footer and does nothing outside TUI. /bruv resources lists actual loaded skills, prompts, context paths and command names, not private file contents. There is no invented resources extension command. /bruv questions open <full-id> explicitly reopens a saved native question. Other question verbs use ordinary owning operations. /bruv help lists operations and gaps.

Missing: terminal question picker/autocomplete inside native T3, arbitrary TUI editor/modals, user-client audio and resume_return dialogs. Child in-place replies remain unsupported. capabilities.savedQuestions and askUserQuestion become true only after an actual parent port binds. Unknown/malformed namespaced commands fail rather than reaching the model. Attachments with control commands are rejected, not silently discarded.

## Proof and next step

`tests/claude-compat-human-controls.test.ts` covers one-time saved reply delivery/use, stale version/owner rejection, denial staying pending, same-ID dedup/reopen, process-loss recovery, explicit restart resume, lifecycle reattach, ask-then-block refresh, no-answer allow rejection, and a correlated answer through actual ClaudeCompatTransport NDJSON. `tests/claude-compat-commands.test.ts` uses actual goal/mode/question registrations and tests ledger/mode writes, goal mutation, data-backed status/resources, ordinary CLI passthrough and human frame scope. Existing question service/runtime/extension and remote-question tests check CLI preservation. Final focused run: 80 pass, 0 fail across seven files; tsc --noEmit passes after prepare-assets. Biome formatting and git diff --check pass.

Two additional existing questions-bridge tests could not execute because this worktree has no dist/bruv. A local build was attempted; it fetched the pinned T3 source, then stopped because pnpm was not on PATH. No build/packaging source was changed to bypass that. Those two isolated-binary checks are not claimed as passing.

Fixtures prove adapter/ledger/transport behavior only. Parent must bind its native runtime and run unchanged official T3 rendered acceptance: discover /bruv, receive a pending question, deny without losing it, reopen and answer once, stop/reconnect and explicitly resume recovered work. No browser/provider/backend proof claimed. No upstream, packaging or release files changed.

Values unchanged. Existing one-owner, durable identity, honest UI and rendered-control acceptance values cover this adapter; no new general rule needed.
