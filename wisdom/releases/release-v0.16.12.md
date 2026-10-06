# Terminal voice release v0.16.12 — in progress

User authorized PR, merge and release after accepting the missing physical keyboard/mic trial. PR: https://github.com/tnfssc/bruv/pull/41. Branch t3/redesign-live-terminal-ui in /home/tnfssc/.t3/worktrees/bruv/t3-7231ab8c. Current product/notes head dec24813. The branch includes latest develop (v0.16.11 and opinion guidance).

Full local gate runs as task_dbb582dc with log /tmp/bruv-voice-release-gate.log. Read-only release review task_147cccd1. Hosted CI must be green, review handled, and merge state checked before merge. Use normal merge, no bypass. Then dispatch release.yml on develop; it prepares the next version and only publishes after the full release gates. Handwritten support/release-v0.16.12.md must be kept. Do not confuse dispatch/tag creation with publication.

Raw copied research and rejected mockups were moved out of the product PR to /home/tnfssc/.bruv/research/voice-cli-t3-7231ab8c. Decisions, links and feature handoffs remain in wisdom. Existing values cover safe release and honest testing limits. No new value needed for the release itself.


Local full gate reached 2,211 passes and 30 opt-in skips, but failed three outer checks. The connector and shared-host failures were incomplete test API doubles missing the new renderer registration hook; the real Pi API already provides it. GPT terminal assertions still demanded the removed separate widget. Parent updates those tests without changing product behavior. Final review also found raw delegated GPT speech bypassing canonical terminal sanitation through session.prompt. Code worker task_9cd7ed4f owns that fix in /home/tnfssc/.bruv/worktrees/t3-7231ab8c-5442693331ce-task_9cd7ed4f. It must be integrated before rerunning the full gate and updating PR CI. No merge yet.
