# Installed v0.15.21: three fast no-op tasks, quit and resume (2026-10-01)

Investigation only; no product changes. Read values.md and native-proof-tooling.md, agreed-compact-actions.md and canonical-task-rows-interface.md before launch. Existing daily-use/reopen and truthful appearance values cover this; values unchanged.

## Reproduction

Evidence: /home/tnfssc/bruv-evidence/resume-v0.15.21-20261001-2046/ (durable home directory). Installed /home/tnfssc/.local/bin/bruv --version returned 0.15.21; binary SHA-256 and exact argv in metadata.json. Used a private tmux socket there, session resume-proof, 110×40, status off; never touched existing user tmux panes/sessions. Isolated empty work/ cwd and sessions/ storage; retained real user provider configuration/auth without copying credentials. Removed inherited BRUV_SUBAGENT_TYPE/DEPTH, PI_CODING_AGENT and PI_PACKAGE_DIR so the installed root was not mistakenly constrained as this research worker. No installs, config changes or build.

Launch: /home/tnfssc/.local/bin/bruv --session-dir /home/tnfssc/bruv-evidence/resume-v0.15.21-20261001-2046/sessions --name resume-three-fast-noop

Prompt is in prompt.txt: launch three parallel fast subagents, titles Noop one/two/three, no tools/reads/changes, reply Done. Root made one execute call using parallel subagent launches. Real openai-codex/gpt-6-astra parent and gpt-6-luna fast children worked. Child journals confirm only user + assistant messages (plus system), no tool calls; each answered Done. (with a period). Root said All three done. Displayed final cost $0.081.

Session ID: 01a0f938-d5cd-75a9-afad-810f84ef16fc
Session file: sessions/2026-10-01T20-47-26-669Z_01a0f938-d5cd-75a9-afad-810f84ef16fc.jsonl

Quit normally with Ctrl-D from empty editor; pane_current_command became fish and CLI printed exact resume ID. Reopened installed CLI using --session-dir above and --session with that absolute JSONL path (resume-command.txt). Captured, then quit normally again and removed only our private tmux server. launch-resume-proof.py is in the evidence parent directory; capture.py is in the evidence directory. Initial attempted inline Python heredoc failed because shell is fish; corrected with saved Python script, no product impact.

## Observations (not inferred)

Six full, unedited ANSI terminal replay PNGs, all opened and reviewed, with exact viewport/scrollback ANSI and readable text:
- sample-005: animated execute label Launch three noop subagents, no source leakage.
- sample-011: three purple ↗ title rows, footer 3 tasks.
- sample-013: first two rows green ✓, third purple ↗.
- sample-014: all three green ✓; no separate settled launch label or completion notice.
- 01-live-settled.png: three green ✓ rows then All three done.
- 02-resumed.png: same active transcript and footer after reopen.

**The reported task-row replay difference did not reproduce in this completed local case.** Active user-message-through-footer ANSI blocks are byte-identical after trimming trailing blank viewport rows; active-transcript-comparison.json records both. Task titles, ticks, colors, blank-line spacing, assistant text, editor cursor and footer all match, including cost, context 2.3%, cache est 60m, model and thinking.

Whole visible screen does differ in regular terminal mode: old conversation remains above exit/resume shell commands, and the reconstructed conversation is printed below it. Live active task rows occupy lines 12–14, final assistant line 16 and footer line 19. After resume the active rows are lines 33–35, assistant line 37 and footer line 40; the older copy is also visible at lines 11–13/15/18. This is terminal history accumulation across process restart, not duplicate rows within the active replay transcript. Nothing was scrolled away or cleared to hide it. First launch also contains command echo/startup shell lines. This could explain a broad “looks different” report, but attribution to the user's report remains unconfirmed.

Screenshots are disclosed full text-identical ANSI replays from existing scripts/tasks-ui-proof-screenshots.ts and cached Chromium, not desktop photographs. screenshots.json records hashes; timeline.json selects the six PNG frames, all-timeline.json retains the complete 90 half-second sample timeline plus named captures. Sampling continued across exit/reopen: sample-075 onwards contain both terminal-history copies, not another task launch. Full journals, session-facts.json, metadata.json, prompt and resume command remain available. No provider/capture blocker.

## Code explanation (inference, not installed source attribution)

Read shared checkout HEAD 9fd15a0109f8778eeb014cc2cfc07f403bdcd8d9; do not equate this commit with the installed binary. src/typescript/extension.ts ~150–165 projects typed launch responses with sourceCallId and emits die:task-row-launch. src/agent/extension.ts ~226–243 persists die-task-row entries; ~906–918 reloads those branch entries on session_start, converts only running to unknown, then installs the SDK adapter. This parent journal has six persisted rows (launch + terminal per child). src/ui/sdk-task-rows.ts ~53–83 combines execute details, typed notices and snapshot rows, choosing the execute component by sourceCallId; later notices have no second owner. That design is consistent with the observed identical terminal ✓ rows after replay. Not a proven installed build-to-source mapping.

Remaining work: obtain user's exact discrepant before/after screen and session/config (regular versus fullscreen, local versus placed root, expanded state, completed versus still-running tasks, one launch versus multiple execute calls). This run does not test expanded view, older saved sessions, placed root or resume while tasks are still active. No speculative fix justified by this evidence.

## Follow-up: cause found

The user supplied a real active-transcript mismatch. [The resume renderer order trace](resume-renderer-order-2026-10-01.md) explains it. This check used direct --session startup, which binds extensions before building messages. In-app /resume builds first, so the addChild-only task-row adapter misses the rebuilt components. Separate completion replies were not the root cause. Do not use this earlier negative result to rule out the in-app resume bug.
