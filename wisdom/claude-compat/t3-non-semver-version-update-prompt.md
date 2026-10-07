# Non-semver connector version and T3 update notices

Research only; no T3 or Bruv implementation changes.

## Source pin

The installed host is ~/.t3/runtime/versions/0.0.46-nightly.20261005.2702 (its .install-complete marker matches). Upstream pingdotgg/t3code tag v0.0.46-nightly.20261005.2702 resolves to cfa4f765ec05950a032b6c1cf9cdfff0c2391545 (git ls-remote). I fetched and inspected that tag archive. Since the exact tag resolves, I did not use main. Prior research pinned main at 365aa87982a4d81cc8e0c085e8d1a40ca7daecdc.

## Conclusion

**Yes, semver-free --version output suppresses the normal latest-update prompt and sidebar latest-update pill in this build, if the entire captured output lacks any dotted numeric triplet. It is not a clean workaround:** T3 records an unknown version, hides the normal settings update advisory, removes version-gated built-in Claude models, and may emit a separate “Claude Code the installed version is too old…” warning. Custom configured models are appended after built-in filtering and remain available, but they do not prevent that warning. These are findings for this exact T3 source tag and Claude path, not universal version-support guarantees.

## Source proof (immutable tag commit links)

1. Version parsing is substring-based: [providerSnapshot.ts:112-120](https://github.com/pingdotgg/t3code/blob/cfa4f765ec05950a032b6c1cf9cdfff0c2391545/apps/server/src/provider/providerSnapshot.ts#L112-L120) extracts the first regex match, \bv?(\d+\.\d+\.\d+)\b, or null. A Bruv product semver anywhere in captured output is enough to be interpreted as the provider version. A product-free text such as “Bruv connector” parses null. The independent runtime claude_code_version and --bruv-version channels are not parsed unless included in that captured output.

2. Null version produces advisory status unknown: [providerMaintenance.ts:722-739](https://github.com/pingdotgg/t3code/blob/cfa4f765ec05950a032b6c1cf9cdfff0c2391545/apps/server/src/provider/providerMaintenance.ts#L722-L739). The lookup gate also requires Boolean(snapshot.version): [providerMaintenance.ts:817-855](https://github.com/pingdotgg/t3code/blob/cfa4f765ec05950a032b6c1cf9cdfff0c2391545/apps/server/src/provider/providerMaintenance.ts#L817-L855), lines 828-832. Therefore no latest-version lookup occurs for null version.

3. Frontend update notification candidates require enabled provider, versionAdvisory.status === behind_latest, and non-null latestVersion: [ProviderUpdateLaunchNotification.logic.ts:140-160](https://github.com/pingdotgg/t3code/blob/cfa4f765ec05950a032b6c1cf9cdfff0c2391545/apps/web/src/components/ProviderUpdateLaunchNotification.logic.ts#L140-L160). The launch notification derives its key from those candidates and returns when no key exists: [ProviderUpdatePrimaryNotification.tsx:122-130,174-193](https://github.com/pingdotgg/t3code/blob/cfa4f765ec05950a032b6c1cf9cdfff0c2391545/apps/web/src/components/ProviderUpdatePrimaryNotification.tsx#L122-L130). Thus unknown does not prompt.

4. Sidebar pill is built from update execution state, not a separate version check: [SidebarProviderUpdatePill.tsx:44-57](https://github.com/pingdotgg/t3code/blob/cfa4f765ec05950a032b6c1cf9cdfff0c2391545/apps/web/src/components/sidebar/SidebarProviderUpdatePill.tsx#L44-L57), [ProviderUpdateLaunchNotification.logic.ts:451-480](https://github.com/pingdotgg/t3code/blob/cfa4f765ec05950a032b6c1cf9cdfff0c2391545/apps/web/src/components/ProviderUpdateLaunchNotification.logic.ts#L451-L480). It can still show a separate recent failed/succeeded/unchanged update result after an attempt.

5. Settings presentation explicitly returns null for unknown advisory: [providerStatus.ts:148-154](https://github.com/pingdotgg/t3code/blob/cfa4f765ec05950a032b6c1cf9cdfff0c2391545/apps/web/src/components/settings/providerStatus.ts#L148-L154); card only renders that presentation when non-null: [ProviderInstanceCard.tsx:585-600,780-820](https://github.com/pingdotgg/t3code/blob/cfa4f765ec05950a032b6c1cf9cdfff0c2391545/apps/web/src/components/settings/ProviderInstanceCard.tsx#L585-L600). Compatibility advisory is a distinct policy path.

6. Separate model warning: [ClaudeModelCatalog.ts:146-168](https://github.com/pingdotgg/t3code/blob/cfa4f765ec05950a032b6c1cf9cdfff0c2391545/apps/server/src/provider/ClaudeModelCatalog.ts#L146-L168) filters out models with a version gate when version is null. [ClaudeModelCatalog.ts:170-185](https://github.com/pingdotgg/t3code/blob/cfa4f765ec05950a032b6c1cf9cdfff0c2391545/apps/server/src/provider/ClaudeModelCatalog.ts#L170-L185) produces the direct “Claude Code the installed version is too old…” message for the first unavailable min-version model. ClaudeProvider puts it in provider message: [ClaudeProvider.ts:556-561,608-625](https://github.com/pingdotgg/t3code/blob/cfa4f765ec05950a032b6c1cf9cdfff0c2391545/apps/server/src/provider/Layers/ClaudeProvider.ts#L556-L561); UI exposes status.message: [ProviderStatusBanner.ts:64-88](https://github.com/pingdotgg/t3code/blob/cfa4f765ec05950a032b6c1cf9cdfff0c2391545/apps/web/src/components/chat/ProviderStatusBanner.ts#L64-L88), model-picker displays getProviderStatusMessage at [ModelPickerContent.tsx:1058-1061](https://github.com/pingdotgg/t3code/blob/cfa4f765ec05950a032b6c1cf9cdfff0c2391545/apps/web/src/components/chat/ModelPickerContent.tsx#L1058-L1061).

7. Custom models are appended after version filtering: [ClaudeProvider.ts:556-560](https://github.com/pingdotgg/t3code/blob/cfa4f765ec05950a032b6c1cf9cdfff0c2391545/apps/server/src/provider/Layers/ClaudeProvider.ts#L556-L560), [providerSnapshot.ts:123-150](https://github.com/pingdotgg/t3code/blob/cfa4f765ec05950a032b6c1cf9cdfff0c2391545/apps/server/src/provider/providerSnapshot.ts#L123-L150). They remain available (except collisions with built-ins) even with unknown version. Version-gated built-ins do not.

## Check and limits

An isolated check extracted the actual parser regex and exact isProviderUpdateCandidate function from tagged source. It passed: “Bruv connector” => null; “Bruv connector 2.1.280” => 2.1.280; unknown/no latest => not a candidate; behind_latest => candidate. This was not a live UI test. The archive had no workspace dependencies, so upstream unit tests were not run. No live UI mutation, provider-auth call, or real update was performed. Exact source proves behavior, but not universal connector support or all future releases.

Values unchanged: existing source-proof, scope, and durable-research values cover this work.
