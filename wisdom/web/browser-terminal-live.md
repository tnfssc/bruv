# Browser terminal and Live experiment

## Request and plan

User asked for a real browser terminal for Bruv. The browser owns microphone and speakers. The remote CLI owns the agent and tools. Prove this first. If it works, add optional `bruv web herdr` (not the default), with Herdr itself running in the terminal and microphone passing through to the right Bruv session.

Current bruv web only prints external T3 setup guidance. Older browser audio notes describe removed code, not a current working integration. Keep the setup guide reachable while adding the terminal.

## Active work

Parent: /home/tnfssc/.t3/worktrees/bruv/t3-6f8b2e16, branch t3/web-terminal-live-mode. Base 02e69f6a.

- Terminal worker task_b6cbd9fe: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_b6cbd9fe. Branch bruv/build-browser-terminal-experiment-b6cbd9fe. Owns terminal server/client, launcher, dependencies and assets.
- Audio worker task_a238e8d3: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_a238e8d3. Branch bruv/bridge-live-audio-to-browser-a238e8d3. Owns Live device transport and audio relay/browser modules. Parent wires server hooks.
- Research task_d3d8604d: current checkout, read only. Uses tvly as requested to find authoritative Herdr source and integration limits. Prior misspelled research task_1d290df5 was stopped.

## Acceptance and boundaries

Use the real PTY and Bruv TUI. A terminal screenshot is not proof of microphone forwarding. Check capture, audio frames both ways, stop and browser disconnect, and no task cancellation on audio disconnect. Distinguish fake media/provider evidence from real audible speech. Loopback by default; authenticate terminal access and validate browser Origin. Remote microphone needs HTTPS or a localhost tunnel. Browser audio must attach to one session explicitly, never silently follow pane selection.

No release, publish or PR requested yet. Workers commit code and plain notes; parent integrates and checks the whole path. Existing values on whole-path proof, evidence honesty, ownership, and small designs apply; no new value yet.

## Local test tools

Herdr is installed at /usr/bin/herdr. Browser automation can use /home/tnfssc/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome and /home/tnfssc/.cache/ci-speed-browser/release-browser/node_modules/playwright-core/index.mjs. These are discovered paths, not proof the new flow works.
