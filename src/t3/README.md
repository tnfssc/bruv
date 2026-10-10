# T3 boundaries

T3 Code is the external host. Fix its Bruv integration in Bruv; do not change,
bundle, or fork T3 Code to implement a fix.

- web/launcher.ts prints external, unmodified T3 setup guidance. It does not start
  a server, extract an embedded payload, seed settings or use a startup fallback.
- tasks/ retains the owned native task bridge and server task ownership code.
  Its name is not evidence that it belongs to the obsolete bundled web build.
- The old bundled T3 inputs, archive builder and optional validation gates were
  retired. They are not part of the current build or test tree.

See wisdom/claude-compat/external-t3-setup.md for the paired connector, absolute
paths, shared Bruv auth/resources, isolated SDK home, exact genuine model IDs
and manual updates. Packaging does not establish native parity.

Existing release gates target unchanged official v0.0.46-nightly.20261004.2644;
old 2623 is not an acceptable pinned target. Release CI composes strict bounded
gates via scripts/release/run-native-release-gate.mjs; proof/official-2644 is immutable
provenance, not a bundled runtime. The upstream Effect queue race remains unfixed.

## Bruv controls in native T3

- `/goal <objective>` starts persistent work. While running, use `/bruv goal status`,
  `/bruv goal pause`, or `/bruv goal clear`. Pause and clear stop foreground work;
  the native Stop button also pauses a goal. When idle, `/goal resume`, `clear`,
  and `budget <N|none>` control it. See [goal details](../../wisdom/goals/goals.md).
- `/questions` lists saved questions. `detail`, `answer`, `open`, `cancel`, and
  `resume` accept their displayed IDs. Answers retain line breaks and can be
  saved while the agent is working.
- `/mode fast|normal|orchestrator` changes Bruv's instructions. It does not change
  the selected model, reasoning level, or the separate Fast billing control.
- `/bruv status`, `/bruv resources`, and `/bruv help` work during a turn without
  taking over its result. Namespaced `/bruv goal`, `/bruv questions`, and
  `/bruv mode` remain available.
- `/bruv live status`, `stop`, and `capabilities` also work during a turn. Live
  audio uses devices on the connector host, subject to its existing opt-in and
  consent controls; it does not use a remote browser's microphone.
- Invalid commands report an error without closing the connector. Actual
  protocol or output-delivery failures still terminate the connection.

Plan mode uses read-only tools, and accept-edits mode adds direct file tools.
Explicit tool selections and permission denials still apply. Goal pursuit waits
when the current mode cannot run its helpers; changing modes does not erase it.

The connector projects saved goals through native synthetic status messages. It
keeps the native turn open across scheduled goal continuations, retaining Stop,
steering, and usage accounting while the next provider request starts. At a real
stopping point, unfinished-result metadata prevents false goal completion.
In T3 2702's Claude provider slot, the idle indicator says **Goal set** for any
unfinished saved goal. Its protocol cannot display Codex's paused, blocked, or
budget fields. Use `/goal status` for the authoritative state and token usage,
and `/goal resume` to continue a paused goal. Clearing a goal removes its native
indicator; querying a completed goal does not restart it.

T3 2702 rejects steering a bare `/goal` command before it reaches the connector:
"Goal commands must run as a separate turn." Use the namespaced `/bruv goal ...`
commands during work. Bruv's command picker and help describe this host restriction.

These are Bruv connector controls. Offline connector and SDK tests exercise their
lifecycle; the isolated native goal acceptance scenario tests the compiled pair
with unchanged T3 and a loopback model. Neither establishes paid-provider or
cross-platform parity.
