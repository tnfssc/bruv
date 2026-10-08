# PR45 Linux fixes: ACCEPT

Reviewed only `8359b01d8ead52b1b96acf1d490497e85095ec02..520dc85b050e61f5f5d31a70ffbb681be370a9dc` (HEAD is the exact tip).

Actual reviewer model: **openai-codex/gpt-6.1-sol**, high thinking. Verified current-session bruv-agent metadata and model_change event (session 01a11b59-61a1-7122-ab83-018d9cfaef2b).

**Findings: none.** No concrete regression or assertion weakening warrants rejection.

- Product: command and host Fast enable refuse incompatible runtime before OAuth reads; inherited startup short-circuits that read. Existing consent, authentication, branch/model/session checks, persisted authorization and request-tier enforcement remain unchanged. Added missing-seam host/startup assertions supplement original command/restore assertions.
- Prompt fixtures: fresh Bun children establish Bruv package metadata before SDK import, matching CLI initialization. All Bruv/project/global expectations and trust/precedence scenarios remain; child exit is also asserted.
- Offline PTY: an owned project resource makes the untrusted banner meaningful; project cwd and SDK paths are owned. Inbox, pre-confirmation authority, durable revoke and offline-owner assertions remain intact. Retention is explicit.
- Runner/replay fixtures: only the known resource-output destination is normalized; gate order/arguments and existing ownership/failure assertions stay. Closed fetch must show structured connection refusal, not generic failure. Child launch and mock shebangs use the executing runtime, with bounded PATH. No shipped runner/replay changes, CI policy changes, skips or broad test cleanup.

Read values.md and both Linux repair notes. Static source/diff review only; no tests, install, preparation, setup retry, guard bypass, product edits, deletion, auth/device/provider activity or shared environment writes. Retained worker log footers confirm 58 passing product-suite tests / 326 expectations and 21 passing replay checks each under Bun and Node. These are reused worker evidence, not fresh execution here. Release stub proof does not establish original shell cleanup.

Prior run 37769727796’s 26 Linux failures and macOS pass are historical, not exact-tip CI proof. ACCEPT is this scoped code judgment; integration/publication and policy-dependent hosted CI remain parent-owned.

Only this review report was added. Existing wisdom and values unchanged: no new lesson requiring edits. No commits/push.
