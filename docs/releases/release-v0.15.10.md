# v0.15.10

## Fixes found through daily terminal use

- Fresh sessions no longer announce old cached legacy completions. Owned job delivery still reaches its original session; explicit history remains available.
- Read cached transcripts as conversation and tool output. Original events remain available through explicit raw mode and machine APIs.
- Remote refresh no longer leaks old-session notices after /new; open menus show freshness without stealing focus and revalidate actions.
- Local capability grant/revoke menus show request scope and confirmation. Offline revocation ends local access immediately and reports when the owner was not notified; it never enables new offline grants.
- Return conflicts expose retained artifacts and recovery details. Menu launches disclose omitted untracked files; oversized inventories use a bounded, explicitly incomplete preview while still allowing tracked-only launch.
- Fix a reproduced concurrent-client SQLite lock-loss race. New lock files are private from creation.

## Validation

Parent suite: 1,351 passed, 17 skipped, zero failures, including all three compiled Docker/SSH gates. Additional compiled-terminal checks covered capability menus, offline revocation, lost launch/answer responses after owner acceptance, and /new to /resume isolation. Typecheck, format and lint passed. Parent also directly inspected repeated-startup and offline transcript screens.

Evidence is Linux Docker with a fake provider, not real Mac/provider certification. Lost-reply tests do not establish arbitrary crash exactly-once behavior. Existing transfer limits and conservative repo return remain. Agent configuration discovery is still parked.
