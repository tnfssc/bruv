# v0.15.15

- Allow normal Codex model switching after native compaction, including Astra → Sol. Keep opaque checkpoint bytes and saved provenance intact; no force option is needed for this switch.
- Fix the Release cache-key test when the runner sets DIE_T3_SOURCE. Keep the production custom-source guard.
- Fix packed-web reuse across Release steps by excluding per-step runner command-file paths, while retaining real input and archive checks.
- Speed up full CI with bounded parallel tests, package download caches, and exact verified web-payload reuse. Keep full behavioral validation for source changes.
- Build release targets from one verified web archive. Keep packaged browser, native Mac binary, and updater gates before publication.
- Guard the web composer against an unavailable Tiptap view during controlled selection updates.

Native checkpoint replay still requires the same API/provider. Dedicated cross-hash recompaction and context-window downshift handling are not included. /shake still refuses opaque checkpoint pruning.
