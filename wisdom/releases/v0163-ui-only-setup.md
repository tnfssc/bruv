# v0.16.3 — UI-only setup and MCP shutdown

## Published

v0.16.3 published at 2026-10-04T11:42:32Z, from 406ce73ba31a94bea097f83e982781687621d3c8. [Release](https://github.com/tnfssc/bruv/releases/tag/v0.16.3); [successful workflow](https://github.com/tnfssc/bruv/actions/runs/37199145709). All jobs passed: deterministic tests, paired builds/checksums, Linux updater, Mac helper/actual binary/updater and six final-Linux-pair native suites. Verified stable/non-draft and all 20 expected assets; no binary downloads merely to rehash. Metadata: [verification](v0163-verification.json).

The first release attempt 37198016485 published nothing. Its last native command assertion sampled transient Working between UI projections; wire and DB were completed and the subsequent screenshot showed Done. A bounded shared30s convergence wait now retains every idle condition and both same-query commands. Real Chromium rejects persistent Working; all six suites passed afterward. No product fix was hidden in that gate correction.

Remaining limits: upstream T3 PR15598 is not shipped by Bruv. Unpatched T3 can fail UI-only forks before our process starts; the Claude-version advisory remains. No full desktop/paid-provider/device parity claim. Values stayed unchanged: real-path proof, truthful status, scoped cleanup and explicit ownership already cover these lessons.

## Preparation history

Draft release guidance only. Current package/latest release remain 0.16.2; parent verifies gates and release/version before any claim.

Use `bruv web` only for setup instructions: no custom T3 startup or parent environment. Install and start official T3 normally. In **Settings > Providers**, add a separate **Claude** provider named **Bruv**:

- Binary: sibling `bruv-claude-compat`.
- Home: `~/.bruv/claude-compat-sdk` as homePath / `CLAUDE_CONFIG_DIR`.
- Empty launch arguments.
- Provider-only environment: `BRUV_CLAUDE_COMPAT_HOME=~/.bruv/agent` and `BRUV_CLAUDE_COMPAT_BRUV_PATH=<sibling bruv>`.

These are defaults under the current home; use the exact paths printed by `bruv web` if installed elsewhere. This reuses Bruv auth/models/settings/resources without copying secrets. Keep normal CLI use. Choose exact configured provider/model IDs; never guess aliases. Do not modify the real Claude provider, use T3 Claude login/update, point it at `~/.claude`, change HOME, or set server-wide `CLAUDE_CONFIG_DIR`.

Local home/model/auth and paired-binary preflight happens before history/MCP allocation. App-owned HTTP MCP lease releases before idle and reacquires next turn; clean shutdown drains owned operations.

**Limits:** PR #15598's provider-scoped history fix is not yet official. Older T3 forks can fail before Bruv starts, so graceful upstream handling cannot be promised. Claude product-version warning remains a separate unresolved issue. No native desktop, paid model, or full parity claim. Update both binaries as a same-version pair after stopping active sessions. Preserve user data. No new release claim until parent verifies.

Values reviewed: values 2 (make ownership and state visible), 3 (preserve clear boundaries), 9 (state what changed and what remains), and 10 (leave proof and next steps). No new general lesson; values unchanged. Related feature guidance: `wisdom/claude-compat/external-t3-setup.md` and `wisdom/t3/mcp-close-ci-observation.md`.

## Integrated checks before the release-failure fix

Hosted CI 37197181001 passed at 506979a7. Local full CI had one unchanged saved-question test timeout; two isolated reruns passed without changing its timeout or assertions.

The native fixtures previously depended on first-authenticated-model fallback. Both run.mjs and run-subagent.mjs now write their exact deterministic model as the default in the private Bruv settings. Health probes have no --model. No real provider credentials or product fallback were added. All six unchanged-official2644 native suites passed with these settings; proof is artifacts/v0163-native-gates-fixture-defaults/. This run predates the review fix below and is not final publication proof.

Independent review reproduced false idle after failed app HTTP MCP release (result withheld, two idle frames, one remote session). Release is held for task_5f976f03 in /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_5f976f03. Rebuild and rerun gates after integrating its fix. No release dispatched yet.

## Final candidate

Integrated the reviewed failure fix as 641d8492. Fatal output failure stops subsequent result/idle/command-completed delivery and closes the transport, including autonomous runs. Real-peer regression covers model, no-model command and autonomous paths; failure is not relabeled clean shutdown.

Focused parent tests, typecheck, paired build and all six unchanged-official2644 native suites passed on the final candidate. Local logs: artifacts/v0163-error-path-tests.log, v0163-final-check.log, v0163-final-build.log, v0163-native-final.log. Retained summaries: proof/v0163-native/. These gates still use their documented integration environment, not proof that unpatched official T3 has UI-only fork support. Upstream PR15598 remains separate. Parent next: push candidate and dispatch gated release, then verify run/release metadata and 20 assets without needless binary downloads.
