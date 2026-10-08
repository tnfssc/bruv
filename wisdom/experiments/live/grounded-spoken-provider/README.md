# Grounded spoken provider probe

Historical provider investigation packet. Its probe and receipts are preserved as recorded; this is not maintained CI.

Source revision: `db10b010e45ae6c40a0bafcd7174c662255707c9` (the checkout from which this packet was grouped). The probe imports `src/live/orchestration.ts` and `VOICE_MODEL`, neither of which exists in that source tree. It is not runnable as-is. No provider probe was run during this move.

Contents: explicit provider probe, validation note, and automatic/manual event receipts. The separate durable handoff guidance remains in [wisdom/live/grounded-spoken-handoff.md](../../../live/grounded-spoken-handoff.md).
