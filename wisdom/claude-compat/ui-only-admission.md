# UI-only setup and connector-owned admission (2026-10-04)

Decision: assume upstream provider-scoped SDK history fix will land, but require
confirmed availability for full UI-only history. Parent separately prepares the
upstream PR; this change touches only Bruv. Official 2644 lacks the fix. Basic
chat may work before it; no guessed-version gate/capability negotiation added.

## Changes and ownership

- `bruv web` and public setup: normal desktop/web startup, no T3 arguments or
  parent environment; instance binary/homePath/env only. Existing Bruv auth is
  reused only by explicitly selecting its home. No secrets copy, default Claude
  writes, global state or migration.
- Stream probes validate explicit absolute native home and writability of existing
  ancestors; refuse ordinary Claude state and aliases via symlinks. They do not
  create history. Auxiliary JSON remains home-independent and tool-free.
- Local model/auth validation precedes nativeStorage, task/runtime extensions and
  MCP connection. Select explicit provider/id or an explicitly configured default
  in selected Bruv settings. No first-authenticated-model fallback; empty/unknown
  explicit models fail. Missing auth is now a startup preflight error rather than
  waiting until initialize after session allocation. initialize/admission still
  recheck local auth; access_verified remains false.
- Startup errors are actionable stderr + exit 1 (T3 may render only generic
  failure); protocol controls still reject errors. No model/tools, history or
  invented task authority on these setup failures. Paired shutdown c64a27ad stays.

## Boundaries and provenance

T3 owns SDK filesystem fork before starting Bruv: graceful handling there is
**not** something this connector can provide. Unsupported-version/update UI is
also a separate unresolved T3 issue, not fixed by the history PR. Do not fake
Claude identity, mask either issue, or claim full 2644 parity.

Read prepared ca8ff40e lineage; selectively applied only f4293a05's genuine SDK
scope regression in tests/claude-compat-history.test.ts. It verifies a pre-fix
unscoped SDK fork fails without touching throwaway ordinary Claude state, with a
separately scoped positive control. That is not recommended parent-env setup.
Old parent launch docs, proof masses and acceptance commits were not copied.

## Verification

- Bun 1.4.2: frozen install, paired build and type check passed.
- 109 focused tests / 19 files passed, 666 assertions, including real compiled
  chat/auxiliary, actual normal child execute, MCP lease teardown, and preflight
  negative cases. Auxiliary uses no native home. Nine setup failure cases leave
  the fake ordinary Claude sentinel unchanged, native history absent and loopback
  model/MCP request count zero.
- Pinned SDK 0.3.276 in Node 24.21.0 against the compiled connector: prompt iterator
  never yields; valid initialize + native get_usage report local configuration,
  access unverified. Missing home (persistSession:false), missing model, and
  unknown model reject with actionable stderr. Zero provider requests and no
  native history/session files even on the valid stateless probe.
- Real SDK filesystem regression includes pre-fix normal-parent missing history/
  fork failure + isolated positive control. No corrected-upstream UI acceptance
  claimed; upstream availability/normal-launch parity and separate version UI
  issue remain parent release readiness work.

Commands, fixture, logs, binary hashes and generated compiled setup output are in
[proof/ui-only-admission](proof/ui-only-admission/README.md). Final full CI and
release are parent-owned. No push/release/global install or upstream edit.

Values unchanged: existing human-selected ownership, real rendered behavior and
honest evidence/limits already cover this lesson (values 6/8/10). Setup and local
readiness do not imply ownership of upstream pre-launch operations.
