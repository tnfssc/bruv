# Connector update uses the Bruv pair updater — 2026-10-07

Branch: bruv/route-connector-update-to-bruv-paired-up-53f15fa1.

## What changed and why

External unchanged T3 can run its configured Claude connector with an update
command. The Bruv connector used to send that command to the stream argument
parser and fail. We can fix the command in Bruv without changing T3 settings,
pretending to be a newer Claude, or disabling update notices globally.

In src/cli.ts, the root dispatch removes the leading claude-compat only when the
next argument is update. This happens before connector bootstrap. The request
then enters the existing normal update branch and src/update.ts. The shipped
thin launcher already execs its physical sibling with claude-compat, so
bruv-claude-compat update and bruv claude-compat update both work on a fresh paired
install. There is no new updater, PATH lookup, or subprocess updater command.
The normal argument gate still accepts only no argument, --check, or --help/-h;
mixed stream flags and other arguments fail before fetching.

The existing updater still owns official paired assets, checksums, staged real
product probes, same-version repair, layout checks, replacement and rollback.
Protocol 2.1.280 and the repository product version are unchanged. No T3 edits,
Claude installs, settings changes, release, push, or real installed updates were
made. README.md, connector/update help, src/t3/web/launcher.ts and
external-t3-setup.md now explain the supported button.

## What this does not fix

T3 compares our protocol compatibility version against latest Anthropic Claude,
not our real Bruv product version. A successful Bruv pair update can still leave
T3 saying unchanged/outdated. Do not claim the notice is gone or invent a version
to hide it. Use normal --version and connector --bruv-version to inspect the real
product. Stop active sessions first and restart T3 after updating. Native T3
button acceptance and provider calls were not run here; this is command-path
proof, not host UI acceptance. Existing host/history limits still apply.

## Proof

Tests are in tests/connector-update.test.ts and connector-update-fixture.ts.
The fixture compiles the real root CLI with a fake fetch installed before entry.
It answers only official release URLs with synthetic metadata/bytes and rejects
all other URLs; it never calls live fetch. The release connector bytes are the
real thin launcher, prepared in a private directory. Every target, HOME and
fetch log is temporary, including the compiled normal binary that gets replaced.
No real installed executable is mutated. PATH has no Bruv.

Seven new checks prove compiled help for all three entries and both help flags;
argument refusal before fetching; the exact source-mode self-update refusal;
read-only connector checks; paired checksum/version-verified update through the
standalone wrapper; missing same-version connector repair through the root
subcommand; and honest bad-connector-checksum failure with both files unchanged.
Existing updater tests also pass, including rollback and retained recovery cases.

Bun 1.4.2 and the supplied local dependency symlink/prepared asset copy were used:

~~~sh
bun scripts/build.ts
bun test tests/connector-update.test.ts tests/update.test.ts \
  tests/update-release-shape.test.ts tests/cli.test.ts \
  tests/product-identity.test.ts tests/t3/web-launcher.test.ts
~~~

86 tests / 469 assertions passed. Focused Biome formatting and git diff --check
passed. Focused lint reports advisory warnings/infos, no errors.

The normal connector build preparation was tried but refused the supplied Pi
host 1.0.0 (this branch requires 1.0.3). Full tsc --noEmit likewise fails in
existing selector lifecycle/performance and SDK markdown APIs absent from that
old dependency tree, not in changed files. No dependency installation or shared
dependency edits were made. Direct build.ts compilation succeeded using the
supplied prepared assets; the thin launcher was generated directly. Copied
ignored runtime package metadata initially said 0.16.3; it was regenerated with
this repository's existing 0.16.13 value, matching prepare-assets.ts, and the
compiled tests were rerun successfully. No tracked version was changed. Full
fresh-dependency build/typecheck remain the parent's integration gate.

Values are unchanged: existing values already call for simple shared ownership,
honest failure/proof and preserving user state. This is a local command-routing
lesson, not a new general rule. See paired-update.md and thin-launcher.md.

## Parent integration

Integrated as db67f86b in
/home/tnfssc/.t3/worktrees/bruv/t3-1c4479b8, branch
t3/fix-bruv-update-recommendations. Parent installed the frozen lockfile locally
with Bun 1.4.2. Pi 1.0.3 preparation, full tsc --noEmit and the normal paired
build passed. This clears the worker's old-dependency gate above.

Parent focused tests passed: 111 tests / 594 assertions across connector update,
existing update/release shape, real CLI/install, identity, terminal guide,
connector launch and thin launcher. Actual newly compiled connector smoke also
passed 3 tests / 148 assertions: loopback stream/schema, real normal child
execution and invalid-setup refusal. No paid-provider requests or real installed
updates were run.

The first combined test command failed the existing installer test with exit
127. Fish expanded PATH into multiple assignments; the last assignment omitted
/usr/bin and /bin, so /usr/bin/env could not find sh. The safe shell probe showed
that exact error; the installer itself passed in a temporary HOME. Rerunning
with an explicit Bun:/usr/bin:/bin PATH passed all 111 tests. No product or test
assertion was changed to hide this tool setup failure.

The setup guide now says to use standalone matched-pair paths, not T3's
package-manager-classified paths. Bruv cannot intercept a package-manager
updater that T3 runs instead of its connector. No desktop Update click was
performed; exact installed nightly source/UI acceptance remains unproven.
Compatibility notices can remain even after a successful update.

Values stay unchanged. Existing identity, simple ownership and honest-proof
values cover the result. No new repeated lesson needs another rule.

Focused read-only review task_bfbce7f8 found no blocking defect. It checked the
strict argument gate, physical normal target, staged pair verification and
fake-fetch isolation. It noted POSIX/supported-platform test scope and external
T3 classification/UI limits. Those limits are recorded above and in setup docs.
The source and wisdom are committed locally. No push, PR, release or real
installed update was requested or performed. Other systems need a release or
source build containing this change before the new command is available.
