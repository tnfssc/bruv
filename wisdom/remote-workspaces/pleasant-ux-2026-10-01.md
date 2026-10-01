# Remote: human entry points and task handoffs (2026-10-01)

Use this when changing remote CLI presentation, not SSH policy or return guards.

Observed in local setup and connected dogfood notes (`setup-ux-dogfood-2026-10-01.md`, `ux-dogfood-2026-10-01.md`, retained in the parent handoff with terminal artifacts). Those hands-on notes exposed an unnecessary binary-path editor, refresh jargon before any work, generic uncertainty advice on Connect failure, buried access requests, and a transcript-first debug firehose.

## Small coherent changes

- Normal Connect asks for a host/alias once and uses the existing default `die` on server PATH. Explicit `/remote connect <host> <die-path>` remains the advanced deployment route.
- Before connection/data, say not connected and offer Connect. After an empty connection, select Launch; no nonexistent tasks to refresh. Once tasks exist, the saved-view/freshness message stays honest.
- Default completions are contextual human actions. Explicit advanced/JSON commands still parse and submit; they are not removed from automation.
- Setup errors explain SSH/binary checks. Mutation errors still explain saved intent, same-ID reconciliation, and uncertainty; do not use answer/cancel warnings for unrelated operations.
- Pending local access sorts ahead of old completed tasks. Access review is the next task action when actionable; otherwise concise details/result precede the full saved transcript. Transcript provenance, paging, raw mode and offline access are unchanged.
- Launch/answer leave the receipt visible in chat rather than covering it with a stale picker. Accepted/running transcript progress says loading; terminal incompleteness and gaps still warn. Applied/no-change repository receipts are shown without inventing changed-file lists.
- After a successful grant, refresh task state; a refresh failure does not retract the granted authority. Never refresh before offline local revocation.

## Proof and limits

151 remote regressions pass (3 opt-in integrations skipped); direct Bun typecheck passes. Focused regressions exercise the human flow and leave pinned owner, question identity/version, stored replies, cancellation truth, explicit untracked approval, capability authorization and current-branch integration guards intact. Compiled terminal acceptance uses a separate HOME/repository, loopback Docker owner, explicit SSH-config wrapper, fake owner provider and ACK-only local provider. No paid calls or real-host app configuration/credentials.

Evidence/proof counts and binary hash are handed off with the PR work; fixture/video files are not feature commits. Production build wrapper needs the packed-web manifest (direct compile uses the existing real payload). This is not WAN/provider-quality/security-policy acceptance. No disconnect redesign or transcript protocol redesign.

Values unchanged: existing values already require actual human-flow proof, honest uncertainty and small useful changes. These are local UX lessons, not a new general rule.
