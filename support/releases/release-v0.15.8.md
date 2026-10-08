# v0.15.8

## Remote controls for humans

- Open /remote with no arguments for a searchable task and question menu. Choose answers or write your own without copying task/question IDs.
- Subcommand, task and question autocomplete with readable labels. Explicit commands remain available for scripts and expert use.
- Escape/back navigation preserves unanswered questions and discarded drafts. Long choices remain readable in narrow terminals. Background polling does not replace an open picker.
- Offline menus keep saved transcripts available and mark actions that need the server. New answers recheck question ownership/version; uncertain replies have a separate reconciliation action.
- Cancellation rechecks task ownership after confirmation and separates local intent, unsent requests, uncertain delivery, acknowledgements and terminal cancellation.
- Shared picker improvements also apply to local /questions.

## Validation

1,281 tests passed, 17 existing skips, zero failures in the parent rebuilt suite. Includes compiled CLI terminal interaction against disposable Docker/SSH native questions, local question menus and Live regression. Typecheck, format and lint passed. This is Linux fake-provider acceptance, not Mac or real-provider proof; remote limits from v0.15.7 remain.

Agent configuration discovery is documented and parked. No configuration API or built-in configuration guide ships in this release.
