# Compact transcript spacing (`src/compact.ts`)

## Why

After the rewrite the transcript lost the 0.x density. The 0.x code did it by changing Pi at
runtime (`src/ui/conversation-density.ts`, `src/ui/quiet-tool-ui.ts`) and by rewriting Pi's
built `chat-viewport.js` at build time so the input needed one row instead of three. The rewrite
banned both and nothing replaced them. Audit of what was lost: blank rows above every reply, tool
line, report and entry; shaded padding around user messages; blank lines inside thinking;
"Thinking..." rows; the Ctrl+O status line; two blank rows above the input.

## Choice

The user chose to bring it back by changing how the running Pi draws, not by editing Pi's files
(a `/bruv-patch` that edits the install was rejected: Pi updates undo it, global installs need
write access, and it would change plain `pi` too). Extensions get Pi's own module copies, so
wrapping prototypes from the extension reaches the real classes.

- Only when `fits()` finds the classes and methods it wraps in the running Pi. Otherwise Pi keeps
  its spacing and bruv says so at startup. This replaced a list of Pi versions (`1.1.0` only):
  every Pi release turned compact spacing off and showed the notice, even when nothing it wraps
  had changed. The check finds removed or renamed parts, not changed behavior; the tests run
  against Pi's real components to catch that. Fields that cannot be checked before a session
  (`hideThinkingBlock`, the user message's `paddingY`, the input slot's `minSize`) are checked
  where they are used, and that part passes through if they look wrong.
- Every wrapper passes straight through when off; `/bruv-compact off` and `session_shutdown` put
  Pi back (session changes and `/reload` load a fresh extension, which wraps again).
- The transcript is found through `InteractiveMode.renderSessionItems`, which Pi calls at startup,
  reload and session changes, after the extension loads.
- Spacing is done by one `render` on the chat container, not per component, and it keeps a mouse
  layout so clicks reach moved rows.
- Hidden thinking is removed from the shown copy of the message, not hidden afterward. Per-block
  click-to-show is lost, as in 0.x.
- Pi keeps one blank row above the input (its widget area spacer). 0.x had it too; kept.

## Checked

Unit tests in `tests/compact.test.ts` use Pi's real components. Checked by hand in tmux with a
made-up session, fullscreen and regular mode, and `/bruv-compact off|on` live.

## Not done (from the audit)

- Job reports split the "N tools called" line; 0.x folded job updates into it.
- The board above the input and the `bruv-turn` line are new rows (by design in the spec).
- Quiet start still needs `/bruv-setup`; 0.x always hid Pi's banner.
- The footer's narrow-width tiers drop cost and cache; 0.x had a short form.
- Upstream Pi issues for spacing hooks were not opened (user said not needed for now).
