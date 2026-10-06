# Stop transcript restoration: reuse consecutive rows, keep every byte

## Decision and scope

Only the pi-tui patch's `dist/tui-alt-screen.js` `afterTerminalStop` changes. Normalize/measure/clip each **consecutive identical rendered row** once, keeping one previous raw/transformed row local to this restore. Every row still enters `lastDocument` and the original output assembly/write loop. No frame/document reuse across stops, persistent cache, async shutdown, output truncation, transcript policy change, or utility/coding-agent edits.

The main-screen transcript still gets a fresh full render at stop. OSC133 zone-prefix stripping, all cursor-marker removal, normalization/reset **before** width/clipping, image passthrough, colors/links, CRLF/erase-line assembly, synchronized output, alternate-screen exit, autowrap, final reset/cursor and capability restoration keep their original order. A one-entry cache is enough for the observed repeated rows and needs no growing Map for unique transcripts.

Read `wisdom/values.md` and `wisdom/tasks-ui/terminal-stall-surface-audit.md` before choosing this narrow fix. Shared harness, fixtures, audit probes/notes and other owners' patch hunks were not edited.

## Matched raw evidence

All evidence and standalone reproduction sources are in [terminal-stop-restore-performance/](terminal-stop-restore-performance/). Base: `9814f356345c450188306de2a7d5b20582c57be0`; Bun 1.4.2, Linux x64. These are small serial local samples, not timing gates or a concurrent matrix.

The **unmodified committed** `scripts/terminal-perf/audit-probes/journal-stop.ts` produced `audit-before.json` and `audit-after.json`:

| Native user payload | Before stop sync ms | Final stop sync ms |
|---|---|---|
| 2 MiB | 19.803, 18.998, 22.395 | **2.127, 2.585, 1.957** |

All twelve matched stop samples (4 KiB, 64 KiB, 256 KiB, 2 MiB; three each) retain exactly the same output SHA-256, bytes, write count, document-render count, document-line count and frame count. The 2 MiB fingerprint is:

- Input SHA-256: `6cdb1e9ac9a39c8429501d0c51da2ef2e6f9effaf5440737a8b5402d338fd844`.
- **33,294 document-child lines, ONE document render, ZERO doRender frames**.
- **4,561,425 ANSI/output bytes**, output SHA-256 `fb481486d21c7676290239d7c3467c5aa35918508515ad4e5396ef000d7715fe`.
- Three counting-terminal writes, including unchanged lifecycle writes, not just the restored transcript buffer.

`stop-unique.ts` is a separate provider-free counterprobe derived from the same stop setup, with 2 MiB of numbered/distinct lines. `unique-before.json` / `unique-after.json`: before **30.544 / 26.647 / 23.959 ms**, final **23.596 / 19.746 / 19.842 ms**. Hash/bytes/counters match; 36,163 document lines and 4,954,478 output bytes. This fixture remains over 8 ms; repeated-row gains do not generalize to all transcript content.

A discarded all-distinct-lines Map trial reduced repeated-row stop to 2.9\u20135.1 ms but made the distinct-row fixture slower (35.161 / 29.341 / 26.608 ms). `map-trial.diff` and `map-trial-{audit,unique}.json` preserve that attempt. The final preceding-row approach is simpler, bounded, faster here, and not a content/uniqueness heuristic.

## Exact synchronous data flow and phase attribution

The committed probe's `segment()` calls `run()` without awaiting; it clocks entry-to-return only. Its hashing/summarization follows the boundary. Construction/setup/first frame are not stop. There is no combined awaited-duration claim.

1. `TuiBase.stop` sets stopped/cancels render timer, disables scheme notifications, invokes `beforeTerminalStop` (search/gesture/image/mouse cleanup and autowrap), shows cursor, restores ProcessTerminal/raw/keyboard state, then invokes `afterTerminalStop`. No `doRender`.
2. `afterTerminalStop` synchronously calls `render(width)` once: the full natural document plus input, not the clipped 32-row viewport. Child component caches are warm from setup. Caching a prior viewport/frame would lose transcript rows or fresh content.
3. Original pipeline: two whole-document stripping maps; `applyLineResets` scans every non-image row through `normalizeTerminalOutput` and appends segment reset; a final map repeats image classification, `visibleWidth`, and optional strict `sliceByColumn`. Identical raw rows therefore repeat all that work.
4. Final pipeline: one map reuses the previous transformed row on exact raw-string equality; otherwise executes **the same ordered stripping/reset/image/width/clip operations**. No utility reimplementation or width assumption. Width is fixed for this call. Results cannot survive another stop or content/column change.
5. Original row-by-row string assembly still includes every row and final terminal controls. One large `terminal.write(buffer)` still occurs. FakeTerminal only retains the string; it is not a PTY write/drain measurement.

`scripts/terminal-perf/audit-probes/profile-stacks.txt` has **27 samples** in stop\u2192width, **12** in stop\u2192image classification, **8** in stop\u2192applyLineResets\u2192normalization, plus **8** directly in afterTerminalStop. These are sampled stacks from a whole-profile run, **not exclusive durations** or summed stop latency; the committed file records the original profile hash.

`restore-stages.ts` / `stages.json` replay those exact transforms serially, with explicitly timed render, strip, normalization, image/width/clip, assembly and counting-write phases. Replay output is checked against actual patched stop, outside timers. Its raw full render has **33,295 rows including the input** (not the child-only 33,294 counter). The replay has its own matched output fingerprint; do not substitute its hash for the committed stop fixture's hash.

Representative repeated-row iteration 2, baseline: render **0.765 ms**, strip **1.945**, normalization **5.292**, image/width/clip **11.585**, assembly **0.706**, counting write **0.003**. Final replay transforms **8 consecutive runs** rather than 33,295 rows: transform inclusive **1.738 ms**, normalization **0.008**, image/width/clip **0.011**, assembly **0.680**, counting write **0.002**. Cache-miss timers add overhead; overlapping inclusive/subphase timings must not be summed. These attribution measurements are **not** the uninstrumented stop gate.

## Compiled PTY restoration and backpressure

`pty-stop.ts` compiles the real shipped TuiAltScreen + ProcessTerminal + SDK UserMessageComponent, provider-free. `pty-check.py` runs that executable inside an interactive bash PTY at 100\u00D732, compares complete captured restore bytes to the source restore buffer (allowing only kernel ONLCR translation), compares before/after `stty -g`, checks raw mode off, one document render/zero frames, and sends a follow-up command successfully handled by bash.

This is a **compiled vendor-path probe**, not a full Bruv application-exit acceptance run. Parent should run the full compiled Bruv lifecycle after integrating other owners' changes. Mouse is enabled in this PTY probe. No emulator raster/image decode performance claim is made.

| Reader | Baseline stop / final write sync ms | Final stop / final write sync ms |
|---|---|---|
| Continuously draining | 72.478 / 38.468 | **50.263 / 41.897** |
| Reader paused for 100 ms at stop | 130.974 / 104.198 | **166.247 / 156.493** |

Raw reports: `pty-{before,after}.json` and `pty-{before,after}-slow.json`; complete PTY captures: corresponding `.bin.gz` (losslessly compressed, no transcript omission). All four captures have **4,960,913 restored PTY bytes** and identical restore SHA-256 `e2b0f55944508bf19566b6560b7d53d3e6cc291efb45cdd8a12e523512d42ffb`. Pre-kernel restore buffer is 4,927,618 bytes; its hash also matches all runs. This is a different TERM/capability environment from FakeTerminal, so compare within each fixture, not across them.

Startup settles with an explicit 200 ms await; `settleAwaitedMs` and total shell elapsed are **not synchronous stop costs**. Each stop and each ProcessTerminal.write has its own entry-to-return timer. Hashing/report-file writes happen after stop returns. Reader hold elapsed is measured separately. One sample per PTY condition is not a stable throughput ranking: the slow-reader final total is worse despite less CPU prep. It **does** prove unchanged complete restoration and that the synchronous final write alone exceeds 8 ms and follows reader backpressure.

## Reproduction and worktree pickup

Worktree: `/home/tnfssc/.bruv/worktrees/t3code-bbf9268f-5442693331ce-task_4f353097`. Branch: `bruv/reduce-observed-terminal-stop-restore-st-4f353097`. `provenance.json` pins source and compiled binary hashes. Only the new final `dist/tui-alt-screen.js` patch section, `tests/tui-stop-restoration.test.ts` and this new wisdom/evidence belong to this change. Parent merges **only that production patch section** alongside other agents' utility/wrapping/Markdown/editor/ScrollView sections; no coding-agent patch delta.

Run serially in an isolated checkout (set BUN to an actual executable if mise trust prevents shim resolution):

```sh
BUN=/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun
E=wisdom/tasks-ui/terminal-stop-restore-performance
"$BUN" install --frozen-lockfile
"$BUN" run prepare:assets           # after reinstall, BEFORE TypeScript
"$BUN" test tests/tui-stop-restoration.test.ts
"$BUN" node_modules/typescript/bin/tsc --noEmit
"$BUN" scripts/terminal-perf/audit-probes/journal-stop.ts /tmp/stop-audit.json
"$BUN" "$E/stop-unique.ts" /tmp/stop-unique.json
"$BUN" "$E/restore-stages.ts" /tmp/stop-stages.json
"$BUN" build --compile "$E/pty-stop.ts" --outfile=/tmp/stop-compiled
python3 "$E/pty-check.py" /tmp/stop-compiled /tmp/stop-pty 0
python3 "$E/pty-check.py" /tmp/stop-compiled /tmp/stop-pty-slow 100
```

For a matched original baseline, **never edit hardlinked installed vendor files in place**. Copy the installed alt-screen file to a private /tmp file, extract only the owned patch section, reverse it there, then copy to a fresh sibling and atomically rename. Keep the after copy and restore it even if a probe fails:

```sh
V=node_modules/@earendil-works/pi-tui/dist/tui-alt-screen.js
P=patches/@earendil-works%2Fpi-tui@1.0.3.patch
cp "$V" /tmp/stop-after.js
cp "$V" /tmp/stop-before.js
awk '/^diff --git a\/dist\/tui-alt-screen.js /{p=1} p' "$P" > /tmp/stop-owned.diff
patch -R /tmp/stop-before.js /tmp/stop-owned.diff
trap 'cp /tmp/stop-after.js "$V.private"; mv -f "$V.private" "$V"' EXIT
cp /tmp/stop-before.js "$V.private"; mv -f "$V.private" "$V"
# Repeat the audit/unique/compiled PTY commands with BEFORE output names.
# Restore using the trap (or the same copy+atomic-rename now).
```

Actual development used that private-copy/atomic-replace approach; Bun reinstall applied the final patch, then prepare:assets ran before TypeScript. `reinstall.txt`, `prepare-assets.txt`, `tests.txt` and `typescript.txt` preserve final check output: **5 tests / 22 assertions passed**, TypeScript exit 0 (empty output). No shared source changes, no PR/push.

## Bounded next step, not a speculative shutdown rewrite

1. Parent integrates this restore-only hunk with the utility-width worker, reinstalls/prepares assets, reruns the same small serial matched audit and full compiled Bruv PTY lifecycle; preserve hashes/counts and shell acceptance. Width work can help the distinct-row case independently.
2. Keep the synchronous API/output guarantee and report its PTY/backpressure budget honestly. This fix removes redundant CPU work; it cannot promise an 8 ms stop while synchronously sending ~5 MB to a slow reader.
3. If a hard responsiveness budget is required, first decide an explicit product-level drain/flush/exit contract and inspect all callers. That is separate lifecycle ownership, not permission to fire-and-forget output, return to a shell before restoration, drop transcript, or change preserveScreen policy here.
