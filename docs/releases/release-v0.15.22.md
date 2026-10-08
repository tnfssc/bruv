# v0.15.22

## Fixes

- Keep background task rows grouped at their original launch after using the in-app resume picker or reloading extensions.
- Reattach task rendering to restored conversation rows without retaining state from the previous session.

## Validation

- Added regression tests for replay ordering, session replacement, expanded output, errors, and images.
- Checked repeated resume, reload, and switches between saved sessions in the terminal UI.
