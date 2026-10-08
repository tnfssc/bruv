# v0.15.25

- Adopt T3 Code’s official Orchestrator v2 development branch at `66a91077`, including its Pi 1.0 integration. This is a pinned development-branch build, not T3’s stable release.
- Reduce the maintained T3 patch by about 81%, using upstream Pi RPC, usage reporting, and CLI lifecycle code while retaining Bruv’s native task and safety hooks.
- Keep the selected conversation, model, mode, and history visible after browser reload and web-process restart.
- Fix the incorrect Pi-version compatibility warning for embedded Bruv.
- Fix excess spacing below the compact prompt in fullscreen terminal mode.
