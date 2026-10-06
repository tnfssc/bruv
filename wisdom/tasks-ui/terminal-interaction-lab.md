# Whole-interaction measurement harness

This note replaces the combined branch's final-results and optimization handoff. This branch ships measurement tools only, with unchanged develop runtime and SDK patches. No old before/after results imply improvements shipped here. Source/extraction details and local verification live in [pickup](terminal-harness-pickup.md).

## Coverage

- Whole-frame profiling: input, animation, streaming, resize, scrollback and task updates with real SDK/Bruv components and bounded histories.
- Action profiling: synchronous input/method prefixes, nested spans, request/frame correlation and heartbeat diagnostics on concrete renderer instances.
- Real SDK InteractiveMode/editor/session send fixtures: short/long Enter, queued steer/follow-up acknowledgment, command, large paste, Bruv disk-backed send.
- Real dispatched tool events: eight bounded event payload cases, subscribed Enter input, burst mutation slices, scheduled output and raw journal evidence.
- Component tool fixtures: 13 shapes with setup plus nine ordered stages, preserved content/screen/output hashes and work counts.
- Scheduled navigation: 14 component modes plus initialized offline SDK selectors/tree/resume/fork. The lifecycle probe does not install the combined branch's selector optimization.

## Boundaries and gaps

A frame-only result is not all-action responsiveness. Async method prefixes stop at immediate return; later continuations count only when separately observed. Keep controlled provider waits, admission/ack elapsed, scheduler delay and heartbeat gaps separate from synchronous CPU. Missing timings are not zero. Inclusive scopes must not be summed.

The component tool fixture lacks a complete mutation-through-frame span; reports explicitly mark it missing rather than add mutation plus frame. Controlled direct tool-event bursts have a contiguous same-turn boundary, but their overall action still spans unobserved continuations. Lifecycle is initialized bare SDK at fixed 80x24, not extension-rich Bruv startup. Queue acknowledgment is not consumption.

No physical terminal paint, PTY backpressure, regular-screen workload matrix, real provider/network latency, comprehensive async continuation coverage or general visual-progress gate is supplied. These measurements do not establish all-app 8 ms acceptance.

Use [runner usage/accounting](terminal-interaction-runner.md), [frame principles](terminal-frame-lab.md), and [guide](../../scripts/terminal-perf/README.md). Preserve failures and evidence; run selected cases serially before expensive measurements.
