# Pi 1.0.3 root host upgrade audit

All four direct Pi dependencies now pin 1.0.3 in package.json and bun.lock. The reviewed published coding-agent tarball has lockfile integrity sha512-t2lb0dw4y/jr5a2PRo6eTHGTZOPB3/YAMVyhhYFC1W3Hl5xE+462I/gMWjF4gCLuhGipNEfuNqONFmdqLFz4SQ==.

Host adaptations remain SHA-256 source- and result-checked in scripts/pi-host-adaptation.ts. Preparation checks every file before any write, and accepts only version 1.0.3.

Upstream review findings:
- dist/cli/args.js changed: 1.0.3 filters empty model selectors. Bruv’s existing MCP/help host adaptation was retained with refreshed exact hashes.
- dist/core/agent-session.js changed at tool-renderer resolution. The queue seam remains; Bruv captures the constructed user object before queue dispatch. The refreshed hashes cover the actual 1.0.3 file. Its declaration seam remains byte-identical.
- Other guarded host file hashes match the pinned source. The compact-editor viewport seam remains necessary and hash checked.
- Exact source → adapted SHA-256: args.js f48f91efc303fc7b826f0ce02ba6eb70fcc271d31671f0f68f562fdd8c6885e6 → 4a3d92e391f2205174c71cfd30a8aed771ad9f560b80c0c6e662322f8e846e83; agent-session.js 35ca1dabd54d98c236c9601b569c2856b726ade392d06b2eaaf50158f48913ab → b6675dce26fc39803b1fe1f9deb1261cb1efc701b585cecd0ac280085dbd8eb6; chat-viewport.js 77ff3d8a3f20950a95cc3b758ab04ee7cffdaba5a490a2390626e781ae30f70a → d8935ff445ff638165a4f11dba32eddea46191377894a8b644ee1511ef36e48f. Other guarded source hashes remain verified in the script.
- The interactive-mode patch was regenerated against 1.0.3, retaining eager grammar readiness for saved transcripts and lazy loading for empty sessions. The old patch hunk fuzzed into malformed code under 1.0.3; the replacement patch was validated before tests.

Proof in worktree bruv/review-and-upgrade-pi-1.0.3-host-seams-51316c7a:
- Bun 1.4.2 bun install and bun install --force installed the four 1.0.3 direct dependencies and applied the renamed coding-agent patch.
- bun run check passed (asset preparation and TypeScript).
- bun run build passed; dist/bruv and dist/bruv-claude-compat were produced.
- Focused integration tests: 85 passed, 0 failed, 616 assertions across tests/pi-host.test.ts, tests/conversation-density.test.ts, tests/foreground-execution-sdk.test.ts, and tests/rolling-activity.test.ts. Coverage includes fail-closed drift/version checks, idempotence, all-files-before-write, built-in removal, source/compiled CLI checks, and Pi UI integration.

Gaps: full Linux CI/full suite, live provider behavior, rendered terminal acceptance, and release validation were not run. Parent should run full Linux CI after integration.

## Parent integration follow-up

Combined gate at 0a029606 exposed stale pins beyond the focused checks: notice fallback still accepted only 1.0.0, its source link still said v0.87.1, and the saved-startup fixture asserted 1.0.0. Updated these to 1.0.3 and the release notice assertion too. Upstream v1.0.3 LICENSE was fetched from GitHub and matched third_party/pi/LICENSE byte for byte. Generator now passes: 211 production packages, 657,017 bytes. The generated bundle stays in ignored dist/release, as before. Saved-startup checks passed all five scenarios; release-workflows passed all 19 checks.

First full Linux gate: 1,952 passes, 30 skips, seven failures. Six failures were those stale pins. The seventh is a reproducible Home-key navigation failure in long-thread-tui.test.ts on local tmux 3.6a. It still fails alone. task_570aade5 owns diagnosis in /home/tnfssc/.bruv/worktrees/t3code-fcaffdf2-5442693331ce-task_570aade5, branch bruv/diagnose-pi-1.0.3-long-thread-home-navig-570aade5. Parent will rerun the combined gate after that result. No green full-gate claim yet.
