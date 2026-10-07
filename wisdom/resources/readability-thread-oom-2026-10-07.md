# Readability thread ran out of memory

Read-only diagnosis on 2026-10-07. No repair or recovery run.

Thread: 03c9ab30-fdd6-4c41-ad2c-fc294a093466.
Its worktree: /home/tnfssc/.t3/worktrees/bruv/t3-6b8c09c6.
Branch: t3/readability-guidance-cleanup.
This diagnosis: /home/tnfssc/.t3/worktrees/bruv/t3-230f6fdf.

## What we saw

- Turns 26, 27, and 28 failed. Last failure: 16:47:13 UTC.
- Journal at 20:47:10 local (16:47:10 UTC) says the kernel killed bruv PID 3096738 for global OOM. It held 14,235,964 kB of anonymous resident memory, about 13.6 GiB. The process was in t3code.service.
- Systemd also reports OOM kills in that unit at 20:03:05 and 20:04:26 local. These line up with the two earlier failures. We did not extract their full kernel records.
- Native session file is 11,884,666,735 bytes. Path: /home/tnfssc/.bruv/agent/native-sessions/2026-10-07T05-19-37-566Z_01a114cd-8c5d-7034-a7f4-bad7093bae8f.jsonl.
- Samples near byte offsets 1, 5, and 10 billion contain bruv-native-task-projection custom entries. These are task cursor snapshots, not conversation messages.
- At 15:55:53 UTC, history.search failed with Active history branch exceeds the 100000-entry limit.
- src/claude-compat/task-binding.ts saves cloned task cursors via owner.appendEntry. Startup walks sessionManager.getBranch(). Cursor state includes childEntries. This is a lead for the growth and resume memory load, not a complete allocation trace.
- T3 shows only Provider turn failed. The journal contains the actual kill reason.

## Next work

Preserve the original history. Do not truncate it or blindly retry the same resume. Trace snapshot write frequency, cursor size, and resume allocation. Make task checkpoint storage bounded without losing actual messages or task delivery state. Test with this kind of long fanout session, not only an empty fixture.

File recovery is a separate unfinished task. The old thread staged nine deleted open files under /dev/shm/bruv-home-recovery-gGiHd8. That staging is RAM-only. This diagnosis did not verify or restore it. Do not infer recovery completion from the thread stopping.

Values stay the same. Existing bounded-resource and safe-recovery values already cover this failure. This note adds measured facts, not a new rule.
