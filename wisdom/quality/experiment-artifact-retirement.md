# Historical artifact retirement

Retired on the working branch; old bytes remain in Git at revision baf2fcd5c9976ee19a8cbc0ae8839875d714cc38 (pre-retirement revision). No history rewrite, ignored/local state deletion, or stale/paid probe execution was performed.

- **T3 npm review:** removed 108 generated before/after proof receipts (screenshots, JSON and text, including source-provenance receipts): 10,612,793 bytes. Kept the concise observed conclusions, reproduction/source notes, review state, harnesses, logs, and patches. The retained status records the PR state; retiring run-output receipts does not assert that the PR is closed.
- **Code-reduction audit:** removed its closed generated 33 detailed report files and 1 joined coverage inventory: 1,042,934 bytes total. Kept the concise closure summary, implementation/validation notes, parent checks, and supporting small records. The quality navigation and audit README now link only to retained material.
- **Structural readability:** deleted nothing. Its 13 JSON inventories total 6,472,192 bytes and contain worktree/task IDs plus incomplete/pending lane status, so they are live resume data—not disposable final reports. Keep them until the coordinator explicitly closes/reconciles the work. Associated prose/harness material likewise remains.

Total retired: **142 files, 11,655,727 bytes**. This is tracked-file size, not a packfile reduction guarantee.

No tracked generator for the structural inventories or T3 proof receipts was found; the T3 reproduce instructions write proof into caller-supplied output directories. No .gitignore or generator change is warranted for this scoped retirement. If the parent wants future policy enforcement, add a deliberate output-only destination/pattern to the owning generator or ignore rule; do not blanket-ignore historical wisdom or active resume state.
