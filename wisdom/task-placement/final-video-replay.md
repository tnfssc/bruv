# Final root + child placement video (2026-10-01)

Read values.md, remote-workspaces/remote-as-task-placement.md and the frozen
PARENT_TASK_PLACEMENT_HANDOFF.md before recording. Parent owns publication.
No push, upload, PR, tag, merge, release or product edits in this recording task.

## Parent checkpoint / export hold

During recording, parent added PARENT_VIDEO_SOURCE_UPDATE.md: preserve df2123
proof truth, but wait for UPDATED_SOURCE_FREEZE.md before the final integrated
export. That updated receipt is not yet present. The existing MP4 is a validated
original-freeze reference, **not** evidence of the refreshed integrated binary.
Parent must either authorize using this honestly labeled original-byte replay
or provide the new frozen binary and matching captures. Do not relabel old
captures with a new source/binary hash. No new compile or production edits here.

## Reproduce

From this worktree, with Python 3 + Pillow, ffmpeg/libx264, and Noto Sans Mono:

    python3 scripts/task-placement-final-video.py

The script takes --proofs, --frozen-tree and --output overrides. It verifies the
frozen binary and both accepted fixture receipt hashes before rendering.
It never starts the product or inference. Source is
    df2123e97d9acbe1244cde54c33faa2929a1fae6

Frozen binary SHA256:
    a5b4b280be56c7ce2a8826c6d46aaf949d1bf9cb856459d404dc52f0f085ce1e

Inputs (absolute default locations):
- /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c/dist/task-placement-freeze.json
- /home/tnfssc/.die/tmp-pi-removal/placement-combined-child-proof
- /home/tnfssc/.die/tmp-pi-removal/remote-root-placement-artifacts-0zcXla

Renderer adapted from task_80e67b72/scripts/remote-video-replay.py; its parked
scenario was **not** reused. Durable output: .die/probes/task-placement-final-video.
The directory contains one final MP4, sanitized screens.jsonl, freeze receipt,
per-original-capture hashes/viewport provenance in receipt.json, and frame samples.
Original proof logs/configs/keys are not copied. Publish only the MP4.

## What viewers actually see

100-second **retimed snapshot replay** of actual compiled CLI terminal captures,
not a live keystroke movie. One-time fixture authorization is separate. Ordinary
placed subagent, selectable /questions, explicit human choice, root --place with
no local provider, detach/reopen same saved question, second prompt, /ps picker
and task details/server worktree, /close source return applied, closed-root reopen.
Root start command is a caption describing the actual fixture invocation, not
synthetic typing. --offline --no-approve were fixture launch flags.

Child local fake provider is ACK-only; server fake provider is tool-capable.
Root presenter has no local provider credentials. Docker network:none, local
SSH fixture only, no real hosts or paid APIs. Native build, not release/web or
paid-provider acceptance. Drift guard is accepted fixture evidence; clean apply
is the on-screen scenario. Existing untrusted-project warnings and intentional
normal-worker delegation refusal remain unchanged.

Scrollback is cropped to the original 120x40 (child) / 120x44 (root) viewport.
This is framing, not rewritten terminal content. Sole content redaction is the
explicitly disclosed disposable fixture HOME prefix; /root worktree stays visible.
No invented inputs, suppressed failures, outcome edits, slides or config dumps.
Selectable menu arrows, choices, Enter/Esc and task cancellation control are real.

## Validate once before handoff

Fully decode the final file, then inspect extracted representative frames with
showImage (child question, reopened root question, task picker, applied return):

    ffmpeg -v error -i .die/probes/task-placement-final-video/task-placement-final.mp4 -f null -
    ffprobe -v error -show_streams -show_format -of json .die/probes/task-placement-final-video/task-placement-final.mp4

Require H264, yuv420p, 100 seconds, faststart moov before mdat. Record final SHA,
decode result and frame timestamps in receipt.json; do not publish a renderer PNG
in place of verifying the final MP4. No repeated QA/polish loops.

Values unchanged: existing truthful-evidence, shared wisdom and no-duplicate-work
principles cover this. Feature-specific replay provenance belongs here.
