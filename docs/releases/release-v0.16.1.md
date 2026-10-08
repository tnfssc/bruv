# v0.16.1

## Long-thread responsiveness

- Improved typing responsiveness and loading animation in long saved conversations, with less repeated history loading and rendering work.
- Saved-session syntax highlighting is prepared before transcript paint, avoiding a redundant full redraw.
- Both `bruv` and `bruv-claude-compat` remain paired; install matching versions for your platform.

## Known limit

One submission-time pause remains. In the measured 1,000-turn conversation, the first input while awaiting a response took **482 ms**, above the unchanged **100 ms** latency target. Later inputs took 48–97 ms, and loading animation improved from 3 to 56 observed changes in five seconds. Request preparation still took about 2.5 seconds. This release ships a substantial partial improvement, not a claim that the full latency gate passes.

See the [measurements and limitations](https://github.com/tnfssc/bruv/blob/v0.16.1/wisdom/tasks-ui/full-frame-latency-followup.md). The external T3 setup and other [v0.16.0 limitations](https://github.com/tnfssc/bruv/releases/tag/v0.16.0) still apply.
