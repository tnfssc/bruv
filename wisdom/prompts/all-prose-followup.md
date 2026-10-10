# Read the text, not just the checks

The user found dense prose in the same execute reference after our follow-up. We shortened a few sentences and called the pass broader than it was. Counts and green checks did not prove the voice.

This pass starts from c338af4c in /home/tnfssc/.bruv/worktrees/bruv-pr-71-all-prose. Same PR #71. Earlier worktrees stay still. User asked for no delegation. Stopped the read-only audit worker; parent did the reading, edits and checks. No worker findings used as proof.

## What got read

Read all active prompt assets, the full execute reference, request builders and authored string values at the model-facing paths below. Followed each to its send or tool-result path. Short error labels already in the voice stay short. Exact names, fields, IDs, limits and schemas stay exact. No runtime paraphraser or text filter.

| Text | Source to model | Work |
| --- | --- | --- |
| Root and child values | prompts.ts → ordinary/native frame | Rewrote system and wisdom. Read identity, roles, workspace and background handoff whole. Short roles kept. |
| Execute reference | typescript/definition.ts → tool declaration | Rewrote whole file. Read sections together, not as separate lines. Cut repeated stop/access advice. |
| Tool results and failures | typescript/{execution,extension,images,job-bridge,output-capture,runner,error-diagnostic} | Shortened result frames, image notes and errors. Kept code, output bytes, artifact paths and JS errors as data. |
| Goal state and wakes | goals/{extension,store}, goal*.md → context/follow-up | Rewrote guidance, state heading and errors. Kept criteria, evidence and pending-job ownership. |
| Saved questions | questions/{runtime,service} → execute replies and follow-up | Shortened waits, stale answers and parent-only facts. Kept owner/version and no-replay behavior. UI-only picker text is not model input. |
| Jobs and attention | tasks/{job-service,task-manager,job-attention,foreground-stop,completion-notification}, agent/extension | Shortened lifecycle/placement failures and notices. Read completion previews and handoff paths. Kept IDs, pending state and output. |
| Native task helpers | t3/tasks/* → jobs helper replies | Read launch, list, cancel, outbox and MCP errors. Short labels kept; delivery-full sentence shortened. |
| Remote work | remote/{client,jobs,owner,operations,placement,job-observations,runtime} | Shortened launch, stop and question text. Notices carry current action, not a second permission manual. |
| Repo snapshots and grants | remote/{repository,repository-wire,source-approval,services,capability-runtime,question-bridge} | Rewrote approval/return errors. Pinned bytes, exact paths, user grants and no second launch stay. |
| Remote utility failures | remote/{artifacts,capabilities,cancellation,job-artifacts,job-events,owner-rpc,repository-download,ssh,untracked-preview} | Read exposed errors. Short labels kept; SSH build and repo-location text shortened. SQL is code, not prompt prose. |
| History reads | history/{service,disk-entry-store,session-manager,shake-record} | Shortened read bounds and damaged-checkpoint note. No branch, exclusion, cursor or opt-in changes. |
| Compaction | compaction*.md, native-compaction.md, agent/{cache-affine-compaction,native-compaction} | Rewrote summary task, checkpoint warning and failure text. Kept format, paid-call bounds, replay route and encrypted state. |
| Direct Live | live/{main-owner,session,openai-session,tool-result,passive-history} | Rewrote context wrappers and errors. History stays data, not fresh orders. Image bytes are not claimed as seen. |
| GPT Live | gpt-live.md, live/{gpt-live-session,gpt-live-delegation,gpt-live-context} | Rewrote client delegation guidance and pending reply. Read setup and quoted observations. No tools added. |
| Voice handoff | session/{host,transcript,transcript-snapshots} → configured agent | Rewrote whole transcript wrapper. Kept ordered snapshot reads, branch scope, missing entries and latest request authority. |
| Voice failure text | live/{audio,playback,openai-errors,openai-connect-error,helper,lifecycle-access} | Shortened safe errors. Unknown access/outcomes stay unknown. Native helper prose is discarded at audio.ts error boundary; code/domain facts survive. |
| Native connector | claude-compat/{runtime,app-worker,binding,mcp,history,task-binding,task-projection} | Read frames, model calls, worker restrictions and return paths. Shortened auxiliary JSON task, errors and replay warnings. |
| MCP and user sources | claude-compat/mcp.ts, system-prompt.ts, SDK loader | External descriptions/schemas, user prompts, AGENTS.md, skill contents and returned data stay untouched. They are not Bruv's prose. No name-as-description fallback. |

Also checked native sources, build assets and SDK patches for authored prompt inserts. No extra active prompt text found there. CLI menus, web UI, diagnostics shown only to humans and source comments are not instructions sent to a model.

Removed unused prompts/live.md. No source, script or test imported it. Its old companion tool names were not the current Live contract. Kept passive-history.ts legacyPrefix unchanged: it reads old saved text, strips that wrapper, and emits plain current context. Rewriting that parser key would break old history, not improve a prompt.

## Checks

Logs and captures stay in .tmp/prose/. The string scan is a reading aid, not coverage proof. Code-shape check compares AST node kinds, identifiers, numbers, regexes and child structure. It ignores string text and formatting. All 54 changed runtime files keep the same structure. Execute schema is unchanged. Whole-request checks keep tool facts in one place and preserve external/user sentinels.

Read captured root, child and goal frames. Runtime tests cover Live, tool continuations, native frames, compaction, question replies and remote notices. No live-provider or microphone claim.

The broad isolated run found stale wording assertions. Updated their expected text, not the behavior being checked. Three unrelated test files also fail on unchanged c338af4c under the same temp setup: async paired-Live continuation, parent-marker wisdom lookup, and tmux question UI. Evidence: base-*.log. Keep these separate from prose regressions.

Final checks: paired build, typecheck, changed-file format and whitespace checks pass. Across the isolated run and focused reruns, 254 of 257 test files pass. The three baseline failures above remain. No full-suite green claim. Latest text is captured in root, fast, normal, orchestrator and goal requests. Target: t3/6c093fbb for #71. Same PR, no new one.

Values stay unchanged. Value 8 already says to review the whole request, keep meaning rather than old wording, and not use check counts as proof of voice. This pass applies it; another rule would not fix the mistake.
