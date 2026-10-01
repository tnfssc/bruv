# v0.15.16

- Let /shake prune eligible completed traces in the visible context of a native Codex checkpoint branch. Preserve the opaque checkpoint, its original provenance, replay shim, and runtime state unchanged.
- Report an honest no-op when there is no newly eligible trace, instead of refusing solely because a native checkpoint exists.
- Honor the SDK's active context boundary and context edits. Keep discarded history excluded and save only proven projection matches.

/shake does not decrypt or prune inside the opaque checkpoint. Automatic shake-before-compaction remains deferred on native checkpoint branches. Invalid checkpoints, incompatible API/providers, unresolved tool batches, and stale context still refuse safely.
