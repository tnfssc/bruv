# Remote workflow decisions

Saved answers read and used on 2026-09-27. These override earlier recommendations where different.

- **When you say “the current repo,” which code should remote tasks receive?** Include tracked uncommitted edits; ask before sending untracked files (recommended)
  Saved reply: reply_383cf659-6b3c-43ee-9b44-c7115219e1f3; question: q_c2b433ef-f3b1-48e8-9d96-beaaddc30cf3.
- **How should remote agents get permission to use tools, skills, and files on your Mac?** Broad access within the current repo
  Saved reply: reply_f97c4d27-66ed-4d6f-9023-a4bd4288ad7d; question: q_79449253-d41e-4242-bdda-8b969cdb097b.
- **When your Mac is offline and a remote task needs a Mac-only capability, what should happen?** Find another way using existing remote capabilities, then wait if blocked
  Saved reply: reply_696124b8-c33d-4b3f-a9ab-454f9d251f07; question: q_4e45d77f-89fa-4613-9aae-f62fb346aa5d.
- **How should the model for a remote task be selected?** Use the server’s configured default, with explicit per-task overrides (recommended)
  Saved reply: reply_90ceaa63-0c4c-436f-888e-990cffe11b6a; question: q_26f67ca9-59d0-4767-9c49-d711ca52bcbe.
- **How should remote code changes come back to your local repo?** Automatically integrate when safe and conflict-free
  Saved reply: reply_da6b4cc3-56d8-44f5-a967-832fddba1a6b; question: q_92e9f0e9-8ebf-41ec-9374-efa9556669d7.
- **What should be available in the offline transcript on your Mac?** All conversation and tool text output; large files separate (recommended)
  Saved reply: reply_0bf24b58-df40-4c46-9378-7d448edc7273; question: q_9843975f-fad3-41d7-a2c3-c737b3564853.
- **If a server becomes unreachable while a task may still be running, what should die do?** Show outcome unknown; wait or let me explicitly retry elsewhere (recommended)
  Saved reply: reply_8d3a5bfd-29c5-4b3c-a088-387001cecaf3; question: q_c83878c9-4bae-46c7-9c6e-e0a1a5cc7419.

Broad repo access is not whole-machine permission or a security sandbox for arbitrary shell code. Do not silently expand paths or transfer credentials. Automatic integration must preserve local work and refuse ambiguous/conflicting results; define and test the safe case. Full offline text requires durable sync and explicit gap handling, not a renamed snapshot. Existing server-default profile and no automatic duplicate-run decisions stand.

Next: extend the single integrated CLI path with durable paged transcript catchup and repo handoff/automatic-safe return. Capability execution follows in the same path. Actual Mac/provider verification still open. Values unchanged; user decisions narrow the design, existing safety and honest-state rules apply.

## Production follow-up (2026-09-27)

The [normal-conversation SSH slice](production-ssh-slice.md) now documents the production module, lasting worktrees, run instructions, verification, and remaining boundaries. Existing repo/capability/model decisions above still stand; this first slice explicitly selects an existing remote repo rather than transferring the current local workspace.
