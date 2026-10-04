## Change

Claude instances with a custom homePath cannot fork because the SDK history helper reads the server environment instead of the instance environment. Run the helper in a scoped subprocess with the provider instance environment, without mutating server process.env. Bound the new fork worker to 30 seconds so a stalled subprocess releases the request and is terminated.

## Scope and approval

Focused bug fix for existing Claude native forking with custom provider homes, submitted under the CONTRIBUTING focused-bug-fix exception. No maintainer approval is claimed. No new settings, provider defaults, schemas or client features. The deadline addresses the new subprocess lifetime introduced by this fix; worker-path selection is unchanged.

## Verification

- Environment regression creates a transcript under an isolated CLAUDE_CONFIG_DIR and checks cursor-limited fork output, unchanged source transcript and unchanged server environment.
- Stalled-worker regression substitutes a real stalled Node child. It fails before the deadline, then verifies the mapped timeout error and actual child termination after the fix.
- All 131 ClaudeAdapterV2 tests pass on Node 24.21.0. Server tsc and targeted format/lint checks pass; lint retains a pre-existing unused-variable warning.
- Locally built and npm-installed Linux-x64 launcher/platform artifacts pass the strict history-only UI trial both at original head c1310b242 and the deadline revision. Provider configuration is entered only through Settings UI; normal server startup uses no T3 options/environment. Real worker exec/stdout/exit traces confirm native fork completion. Trial also verifies continuation context, rollback, page reload/reopen, preserved root question and unchanged ordinary Claude storage.

Server/package builds are pinned to the named heads; existing parent prebuilt web/resource-monitor assets were copied unchanged. No desktop, other-platform, full-CI, server-restart, official-release or all-scenarios acceptance is claimed.
