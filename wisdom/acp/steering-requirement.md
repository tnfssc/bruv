# Required: real steering through T3

User added this requirement while the adapter-only spike was running: proper steering mechanics from the CLI must still work through T3 Code UI.

Queueing for the next turn is not sufficient. Keep-open root lifetime alone is not acceptance. Need actual rendered T3 Steer action while Bruv work is active, input delivered through the real engine steering path at its supported boundary, continued work reflecting the correction, and no silent loss. Distinguish normal queued input, explicit steering, foreground interruption, and Stop/session-work cancellation. Steering must not silently cancel background children or create a second execution owner.

The ongoing prototype and source review predate this explicit requirement, though both were asked to inspect input/steering. Parent must not conclude adapter-only feasibility from queued messages alone. If unmodified T3 can only cancel/restart for this provider or hides the required control, report the exact constraint before choosing a workaround. CLI steering itself has safe application boundaries; no claim it changes an already-running shell command retroactively.

No T3 edits, migration or release is approved. Add concrete proof to the adapter-only handoff before calling this solved.
