# Live mode (voice): planned, not started

The user wants a good live mode back. It was cut in the rewrite (`.agents/notes/rewrite.md` D5) because the
0.x versions were attempts to talk to the agent from another device, and none of them reached SSH or
T3 Code. The user still wants voice; that reason was about the old design, not about voice.

## Where the old code is

Tag `v0.16.25`: `src/live/` (about 40 files), `native/` (Swift/C audio helper), the `/live` command,
and `site/assets/demos/live.gif` (README only; the website never showed it). It used Google Live and
two separate OpenAI realtime stacks. It ran on the 0.x binary and its Pi patches, so it can't be
copied back as is.

## Before building

- Decide where the microphone and speaker are: the user's own machine, while bruv runs over SSH or
  in T3. This is what the 0.x design never solved.
- Pick one provider stack, not three.
- Build it as part of the Pi package, with no Pi patches (`AGENTS.md`).
