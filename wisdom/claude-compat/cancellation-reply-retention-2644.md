# Cancellation reply retention on official2644

## Finding: no lost connector reply

The composed default-controls failure at driver.mjs:136 was a recycled-DOM locator failure, not persistence/projection/history loss. Do not add assistant-channel guesses, another human prompt, fabricated lifecycle boundaries, or notification suppression to compensate.

Pinned upstream: unchanged official `v0.0.46-nightly.20261004.2644`, source `737993303d36e10674c54b95e5bd3826682c99c7`, binary SHA256 `53fbd1c78ab3a01ea91913f65dc17b9d7824f00a81564e06992a73e183054e48`. Exact excerpts/full-file hashes are in [proof/source](proof/cancellation-recycled-dom-2644/source).

## Evidence chain

The retained parent proof showed two distinct native assistant UUIDs/message IDs, with the same consumed human UUID, before one result/idle boundary. Reproduction with the real local pair confirms that source ordering. The pinned Claude adapter takes native identity from assistant UUID (line 1022), deduplicates only that identity, and emits separate node/message/item artifacts (line 4972). Both replies become separate completed assistant items.

[Reproduced failure](proof/cancellation-recycled-dom-2644/failure/result.json) remains FAIL; post-failure diagnosis never turns it into a pass. Read-only inspection of the actual scoped T3 SQLite database finds:

| Item | Ordinal | Run hash |
| --- | --- | --- |
| ACCEPT_CANCEL request | 7000001 | 9d306d3a9887de74 |
| CANCEL_CONFIRMED_REAL | 7000003 | 9d306d3a9887de74 |
| CANCELLATION_COMPLETED_REAL | 7000004 | 9d306d3a9887de74 |

See [persisted projection](proof/cancellation-recycled-dom-2644/failure/t3-persisted-item-projection.json). Their IDs are distinct. Model completion wake count is exactly one.

After the old `.getByRole(...Worked for...).last().click()`, [disclosure inspection](proof/cancellation-recycled-dom-2644/failure/diagnostic-disclosures.json) finds early-return run `653e9ce13df76403` expanded, but cancellation run `9d306d3a9887de74` still **collapsed**. Clicking the actual cancellation run’s `data-timeline-row-id=turn-fold:<real run ID>` renders both replies. Reloading the real thread and opening that same disclosure renders both again; its historical screenshot was retired while the diagnostic JSON and conclusion remain. See [artifact retirement](../quality/protocol-artifact-retirement.md).

Exact2644 renders with LegendList, keys rows by source row ID, and recycles slots by row kind (MessagesTimeline.tsx:1336,1427). Physical DOM slot order is not conversation order. The same bug affects `body.innerText`: the reopened diagnostic text reports completion before acknowledgement even though its screenshot visibly shows request, acknowledgement, completion in that order.

## Focused correction; assertions retained

Only the acceptance driver changes behavior; connector and normal CLI source are unchanged. The gate opens the disclosure using the **actual T3 cancellation run ID** observed in its real user-message projection. It still requires the original and completion replies visible before and after reopen. The unchanged chronology assertion still requires request < acknowledgement < completion, measured from actual rendered message-row vertical positions rather than recycled DOM slots. Tool-output text cannot substitute for a message row. This is not a wire-only substitute for the browser check.

The [passing real gate](proof/cancellation-recycled-dom-2644/pass/result.json) includes Steer, Stop with owned-process exit, explicit cancellation, single completion wake, reload/reopen reply retention, strict same-thread visual chronology, and continued-session reply. Its [initial visual chronology](proof/cancellation-recycled-dom-2644/pass/cancellation-visual-chronology.json) records DOM slots in order completion/acknowledgement/request, at tops 760/725/556; correct **visual** order is request/acknowledgement/completion. Reopen retains the same message identities at tops 485/654/689.

Failure and pass invocation manifests have **identical real pair hashes**. No connector fix was warranted. No upstream/T3 edits, synthetic prompts/events, sleep/drain workaround, dropped completion notification, fake usage/result, credential/payment/device/global/release action, or normal CLI change was made.

## Reproduction/checks

Built in this worktree with explicit Bun 1.4.2 and TMPDIR=/var/tmp:

    env TMPDIR=/var/tmp PATH=/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin:$PATH /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun run build

Real gate:

    env TMPDIR=/var/tmp BRUV_CONNECTOR_EXECUTABLE=$PWD/dist/bruv-claude-compat BRUV_RUNTIME_BINARY=$PWD/dist/bruv T3_UPSTREAM=/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_a7cf65dd/.cache/t3-official-2644 BROWSER_PATH=/home/tnfssc/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell PROOF_OUTPUT=$PWD/.cache/controls-final-2644 /usr/bin/node scripts/claude-native-acceptance/run.mjs

Bun check PASS. Focused regressions: 27 pass, 6 optional SDK-filesystem tests skipped because their SDK path is absent, 0 fail. New regressions cover same-epoch reply/stream identity retention; recycled DOM versus visual chronology (missing and reversed replies still fail); and exact-run disclosure selection. Other composed gates passed in the parent’s retained proof and were not rerun or weakened here.
