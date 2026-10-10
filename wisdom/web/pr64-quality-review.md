# PR64 review decisions

Keep real PTYs, shared input/output, local navigation and explicit voice ownership. The review removed spare extension/auth/launcher paths, obsolete modal editing and the unshipped CommonJS patch instead of adding controllers or another UI store. Required license data stays.

Browser fixtures are not another DOM or renderer implementation. Real Chromium owns focus, dialogs, layout, Ghostty and event behavior. Raw-PTY checks own transport bytes, replies, reconnect and access expiry. Device and editor tests use their real boundaries. Keep a failing mutation for race protections; a rejected invalid ticket is not proof of stale-close safety.

The first ownership cleanup exposed callback-composition recursion and false acknowledgement after replay eviction. Submit capture is now scoped to input handling, and uncertain reply loss uses the existing gap path. Keep the small tests for both rather than adding permanent registries.

Current contracts and commands live in [browser ownership](browser-terminal.md), [surface behavior](surface-rethink.md), [Ghostty constraints](ghostty-renderer.md) and the [operator guide](../../src/web/README.md). Old status diaries are recoverable from f54a51c7. Values 2, 3 and 10 already cover honest proof, clear owners and concise durable notes; no new value is needed.
