# Parent Fast host trace and connector binding

Checked 2026-10-07. Worktree based on b993955e, branch bruv/t3-fast-mode-binding.
Read [values](../values.md), [child diagnosis](child-fast-mode-diagnosis.md),
[native Fast](../native/native-fast-mode.md), and [Pi 1.0.3 OAuth notes](../native/openai-chatgpt-fast-mode-pi-1.0.3.md).

## Actual official host input

Read the installed host **without editing it**:
/home/tnfssc/.t3/runtime/versions/0.0.46-nightly.20261005.2702/t3.
Its embedded source identifies Claude SDK **0.3.276**. GitHub release API confirms
v0.0.46-nightly.20261005.2702 targets **cfa4f765ec05950a032b6c1cf9cdfff0c2391545**.
Pinned raw upstream source agrees with the binary.

- [claudeModelOptions.ts](https://github.com/pingdotgg/t3code/blob/cfa4f765ec05950a032b6c1cf9cdfff0c2391545/apps/server/src/claudeModelOptions.ts#L28-L62)
  compiles explicit Fast to **settings.fastMode**, when the catalog exposes its boolean option.
- [ClaudeAdapterV2.ts](https://github.com/pingdotgg/t3code/blob/cfa4f765ec05950a032b6c1cf9cdfff0c2391545/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L830-L875)
  passes selection settings to the SDK query. The embedded SDK puts settings in
  its launch arguments as **--settings** (query() JSON-stringifies object settings
  before ProcessTransport emits argv). It has no native **--fast** input.
  SDK applyFlagSettings sends **apply_flag_settings**, with an object **settings**.
- The adapter includes compiled settings in queryIdentity. Changed selection normally
  replaces the query and resumes the same native thread, rather than calling the SDK
  Fast control. Both fresh and resumed launches therefore need this binding.

Explicit boolean Fast selection is the opt-in authorized by this task. Effort,
worker type=fast, a label, unknown flags, arbitrary settings, and environment hints
are not billing consent. A missing input stays missing.

## Remaining host and UI gaps

The pinned adapter calls compileClaudeModelSelection **without the instance custom
catalog**. It defaults to BUNDLED_CLAUDE_MODEL_CATALOG.
[ClaudeModelCatalog.ts](https://github.com/pingdotgg/t3code/blob/cfa4f765ec05950a032b6c1cf9cdfff0c2391545/apps/server/src/provider/ClaudeModelCatalog.ts#L139-L144)
returns EMPTY_CAPABILITIES for an unknown custom OpenAI model. Thus a saved custom
model Fast option can be dropped **before Bruv receives it**. This explains why
saved true is not evidence of a launch authorization record. The connector cannot
safely recover that lost selection. An upstream host fix must compile using the
provider instance's actual custom catalog. No installed-host edit was made.

The exact pinned [ProviderSubagentBar.tsx](https://github.com/pingdotgg/t3code/blob/cfa4f765ec05950a032b6c1cf9cdfff0c2391545/apps/web/src/components/chat/ProviderSubagentBar.tsx#L20-L35)
has modelLabel and effortLabel, not Fast status. No speculative projection field
or label-only patch was added. Neither saved options nor a badge prove execution.
Composer end-to-end acceptance still needs the host catalog fix plus a rebuilt
connector; native app-task-backend Fast propagation is not proven here.

## Connector change

Launch policy accepts only boolean settings.fastMode. Production CLI binds it to
the existing native Fast extension after session_start. The SDK-shaped idle control
accepts only boolean fastMode; unrelated/invalid settings fail. The extension's
setWithCostConsent shares persistence with /fast, retains session/branch/model/auth
scoping, and checks native support and concrete runtime compatibility. Append failures
restore the branch; failed opt-out retains the existing volatile opt-out protection.
Unsupported true fails, not a cosmetic success. False on an unsupported provider
creates no authorization. Auxiliary true is unavailable.

No new provider tier implementation, inheritance authority, model routing, or effort
mapping. Existing concrete request guard still owns priority/default serialization,
auth/endpoint checks and late payload mutation rejection. Existing JobService still
launches local/SSH children from nativeFastEnabled(ctx), not composer state.

## Proof and checks

**tests/claude-compat-fast-mode.test.ts** runs the real production runConnector with
--settings Fast input and real inbound NDJSON initialize/user/control messages.
Real Pi AuthStorage/ModelRuntime and the pinned Responses serializer dispatch to an
offline mock fetch. API-key and canonical ChatGPT OAuth requests select **priority**;
control false selects **default**; malformed control does not alter effective selection.
The persisted entries bind the actual Pi session/model/auth surface. Explicit
unsupported provider selection is refused without premium entries.

Its inheritance test supplies the real parent extension context to **JobService**,
captures its ordinary local launch environment (spawn is mocked), boots a distinct
real child Pi runtime from that environment, and checks its serialized **priority**
request. Parent off changes the next launch to inheritance=0; the already-authorized
child keeps its own session authorization. This is not a live child process or SSH
acceptance test. Native task-backend inheritance remains out of scope.

- Seven focused outer suites: **83 pass / 0 fail / 480 assertions**.
- Direct isolated inbound/inheritance suite: **5 pass / 0 fail / 58 assertions**.
- Typecheck **bunx tsc --noEmit**, focused format, and git diff --check passed.
  Focused lint had no errors (34 warnings / 36 infos, mostly existing/test any usage).

First setup attempt found mismatched hardlinked Pi SDK files and missing generated
assets. Restored only this worktree's Pi 1.0.3 dependency from the published tarball,
applied this repository's dependency patch, and prepared assets. Detached local
inodes before writes; no installed host or other worktree was edited. Early tests
also caught two stale expectations that Fast settings were unsupported; updated them.
A fish assignment error was rerun under explicit bash. No failed check was treated
as proof of success.

No live provider request, tier/latency guarantee, account-credit/billing proof,
installed binary update, push or PR. Values reviewed and unchanged: existing real-path,
proof-scope, one-owner and consent boundaries cover the lesson.
