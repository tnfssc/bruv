Claude instances with a custom homePath cannot fork a message: the SDK fork helper reads the server environment, not the instance environment, and reports “Session … not found”.

Run the fork through the existing history worker with the instance environment and Effect-scoped process cleanup. No global env mutation, new client, or unrelated child-lookup fix.

Verified at c1310b2429625e704ef20a175e8b2847f58589ba:
- Real-SDK regression fails on unchanged main eac52f0087, passes here. 135 focused adapter/home tests, server typecheck, targeted format/lint pass (one unchanged baseline unused-layer warning).
- Real normal-startup, Settings-UI-only custom-home fork, continuation, rollback and reload/reopen passed. Root execution was not duplicated; child jobs/questions stayed empty and the root question stayed pending. Deterministic local model, no credentials or weakened assertions.
- Server and web assets built from this exact head and privately copied. Source-built Node/web evidence, not official binary, desktop or SEA verification. The connector's unsupported-version advisory remains visible; no version spoofing.

AI-assisted in Bruv; independent review by openai-codex/gpt-6.1-sol found no actionable issues. Playwright UI/local deterministic-model harness. No maintainer approval implied.
