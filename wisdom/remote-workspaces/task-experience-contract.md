# First remote task experience

Design checklist for the experiments, not shipped behavior. User prefers MacBook plus one Linux server and allows preinstalled, authenticated die remotely. Do not build environment copying or a machine mesh first.

## Connect

Show host identity and compatible runtime/protocol version. Report the remote task default (provider, model and supported reasoning setting). The Mac's Live model can differ. Never send secrets back in discovery. Credential configured is not the same as provider access verified. Real auth refresh still needs a later network test; fake-provider fixtures must say fake.

Start with one named remote default. Local coordinator can ask for a different supported profile/model. Server resolves and reports exact effective config before acceptance. Unknown model/profile must not silently fall back. Changes to defaults affect new launches only.

## Launch

User sees local and Linux tasks in one conversation. The client saves its launch ID and intent before sending. Until server acceptance is known, show pending or confirming, not running. A link loss after sending is ambiguous; reconnect/reconcile same ID rather than sending a fresh task. Show where the agent runs and which model was resolved.

Repo/workspace selection is separate from model profile. Identify source revision and local changes when task needs code. On-demand preparation is fine; do not assume whole repo/skills/CLI cloning. A task needing uncopied Mac files will wait when Mac is gone.

## Disconnect

Closing Mac detaches presentation and local coordination. It is not a cancel command. Linux continues independent accepted tasks. A remote task that needs a Mac capability or user decision saves the request; other tasks can continue. Parent cannot silently answer its own approval request.

A future local bridge should expose one explicit allowed capability first, not arbitrary shell by default. Give each invocation an ID, arguments and visible destination. A lost reply may mean a mutation ran; check before retrying. A read-only fixture can prove the transport without granting broad access.

## Reconnect and offline reading

Read the Mac's on-disk transcript before attempting network contact. Show last synced cursor/time and connection state. Do not label a cached running state as fresh remote status. Server offline is not task failed. Catch up only missing events. Persist events and cursor together before acknowledging them.

Actual assistant messages and tool outcomes must be present for full offline transcript claims. If large output is lazy, show its size and local availability. A reference is not readable output. Keep selected active tasks responsive without downloading every historical task at startup.

## Questions and stop

Pending questions remain visible until answered or withdrawn. Sending a reply is not evidence it was accepted. Retry by reply ID and reconcile conflicts. Cancellation requested, acknowledged and task stopped are separate states. Client disconnect alone must never issue cancellation.

Server restart is not client reconnect. Old live task state may be unknown; do not replay tool side effects. Runtime/stream identity must make reset distinguishable from an empty event page. A bounded retention gap should say what is missing and how to resync, not silently advance the cursor.

## Next acceptance test

One conversation launches a real remote die task using a resolved fake-model profile. Kill client, see subsequent tool/model turns remotely, reconnect to persisted transcript, stop owner and read cached history. Invalid config must fail clearly. Then add one harmless on-demand Mac fixture, checking it waits while Mac is absent. Network experiment should measure how streaming changes perceived progress and request count, not just bytes.

This stays a UX checklist until real Mac/Linux SSH and provider login work are tested. Values unchanged; truthful status, safe recovery and one owner already explain the rules.
