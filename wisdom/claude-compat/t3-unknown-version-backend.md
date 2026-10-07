# T3 unknown-version backend check — 2026-10-07

New research task. This does not change the completed connector-update branch.
User asked whether a non-semver --version can hide the latest-update notice.

Checked the exact host release v0.0.46-nightly.20261005.2702. Its tag points to
cfa4f765ec05950a032b6c1cf9cdfff0c2391545. Prior research read a different newer
main revision; this check uses the host tag rather than assuming main is equal.

## Result

providerSnapshot.ts:116 extracts ANY dotted semver from stdout plus stderr.
Bruv connector alone returns null. A label containing bruv 0.16.13 does not:
it gives T3 0.16.13 to compare with Claude.

providerMaintenance.ts:828-832 requires Boolean(snapshot.version) before its
latest lookup. deriveVersionAdvisory:722-738 returns unknown and no message
when version is null. providerCompatibility.ts:59-100 also returns unknown
with message null for an unknown installed version. Unknown is not unsupported.

ProviderUpdateLaunchNotification.logic.ts requires behind_latest. Extracted
unchanged predicates return false for both launch and provider-settings update
candidates with a null version. Old 2.1.280 and real product 0.16.13 strings
remain update candidates against a synthetic latest 2.1.999.

## Remaining warnings and scope

ClaudeModelCatalog.ts:146-185 removes version-gated built-ins for unknown version
and can produce its separate too-old model message. Layers/ClaudeProvider.ts
allows installed/ready with a null version if its capability probe succeeds;
if capabilities are missing it keeps the existing auth warning instead. It adds
custom entries via providerModelsFromSettings after filtering built-ins. Exact
custom Bruv IDs are not filtered by this CLI version.

No full desktop run or SDK startup proof was made. The latest-update predicates
are proved, not all future T3 versions or all provider warnings. Other enabled
outdated providers can still make T3 show their own global update notification.
The current catalog reports ordinary Claude disabled/not installed; this is not
an assumption for other systems. Keep the actual product in --bruv-version and
keep the supported protocol in SDK init; this check changes neither.

## Reproduce

Run Bun on proof/t3-unknown-version/check-backend.ts. It fetches exact pinned
upstream functions and semver helper, then runs 11 assertions in a temporary
file. No fake implementation of the parser, advisory, compatibility classifier,
model gate or UI candidates is substituted. The synthetic policy/catalog/latest
are explicit test inputs. The first fixture used wildcard *; T3's helper did
not select that policy. Replacing it with valid >=0.0.0 made the policy check
exercise the intended null-version branch. No source/assertion was weakened.

Temporary original probe: /tmp/bruv-t3-version-check-cfa4f765. The durable script
above refetches by SHA, so no temporary files are needed to resume.

Research worktree: /home/tnfssc/.bruv/worktrees/t3-1c4479b8-5442693331ce-task_63490595
Branch: bruv/trace-t3-update-ui-for-unknown-connector-63490595.
UI worker task_63490595 owns the separate frontend trace. No Bruv source, T3
settings, installed binary, auth data, or update/release has changed here.
Values stay unchanged: exact-host proof and clear identity already cover this.

The durable refetching probe passed all 11 assertions. Its first generated copy
had a newline escaping error; that script-only error was fixed before this run.
No T3 function or expected result was changed. Frontend trace is separate.
