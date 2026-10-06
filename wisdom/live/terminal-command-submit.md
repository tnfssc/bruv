# Complete commands in the terminal harness

Release run 37470019054 for v0.16.13 failed at `/liveptt start`.
The Linux and macOS CI frames had the loaded fixture, saved seed, and command still in the editor. macOS passed on retry. Logs: `/tmp/bruv-v01613-release-linux.log` and `/tmp/bruv-wisdom-macos-ci.log`.

Pi treats Enter on an argument suggestion as accept, not submit. The test only dismissed suggestions for `stop`. Whether the menu was ready at Enter made `start` depend on timing.

Use bracketed paste for a complete harness command, then one Enter. Paste does not open suggestions. Keep real typing for draft and gesture tests; test suggestion menus by their own visible flow. Do not send another Enter on timeout or add a sleep.

Startup was checked too. Pi installs the submit handler before rebinding the session, which emits the fixture notice. The seed is rendered after that. This failure did not need a new readiness wait.

Proof: the real Pi editor test opens both start and stop argument menus and shows that Enter accepts without submitting. The same editor submits the pasted command once. The real PTY test passes at 80 and 120 columns with all speech, draft, stale-frame and replay checks kept. The related harness and Live terminal checks pass: 17 tests, 162 assertions. Locked install, assets, paired build, typecheck and touched-file Biome checks pass.

No device or provider was called. No hosted rerun, full Linux gate or actual macOS run was done here. Parent owns PR, merge and release. Values stay the same: the existing fixture, real-flow and honest-proof lessons cover this fix.
