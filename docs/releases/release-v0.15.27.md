# v0.15.27

## T3 Code upstream main

- Move the embedded T3 integration from its development branch to upstream `main`, pinned at `8bc40b4e07bb7b4b0f71876d59520360c9bf958c` after the orchestrator v2 merge. Builds remain reproducible; they do not track a moving branch.
- Keep official Pi support and Bruv task, question, identity, cancellation and packaging behavior.
- Replace retired custom chunk-layout assertions with checks for real lazy-loaded codec, grammar and chat-route assets. Keep static initialization-cycle protection and include the checks in build/cache ownership.
- Correct test synchronization and temporary-path assumptions without weakening security or task-identity assertions.

Validated migration paths include saved history/usage/cost restart, native child/Stop/reconnect, browser route reload/backend restart, real HEIC decoding and C++/Elisp WASM highlighting. Paid providers, real devices and all-platform behavior are not inferred from those local checks; publication still requires the normal hosted release gates.
