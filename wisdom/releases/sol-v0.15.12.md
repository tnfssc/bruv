# GPT 6.1 Sol release v0.15.12

Published https://github.com/tnfssc/die/releases/tag/v0.15.12 . Release run 36631518026 passed all gates, including Mac binary/updater checks. Verified stable non-draft status, all 12 expected assets, and SOURCE.txt commit f9428de7f69e4420adf6222ade5d46b9fd48cffc matching the tag. Local develop fast-forwarded to it. No local installation.

Pi 0.99.1 supplies gpt-6.1-sol for openai and openai-codex. Catalog, picker and compiled CLI were tested offline; live account entitlement is not verified. Full local tests: 1353 pass, 20 skip, 0 fail. See [upgrade handoff](../dependencies/pi-0.99.1-sol-upgrade.md) for history fixes and durable worker paths.

Daily dependency PR automation is still unfinished. Its worker task_e8fd5c4b was killed during the user restart. Retained worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_e8fd5c4b, branch die/daily-dependency-update-pr-workflow-e8fd5c4b. Check that worktree before resuming; nothing from it was integrated.

Wisdom updated for the dependency migration, model proof, history adapter and release. Values reviewed and unchanged: existing behavioral dependency review and truthful delivered-path proof cover this work.
