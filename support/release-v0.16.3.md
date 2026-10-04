# v0.16.3 — UI-only T3 setup and clean MCP shutdown

Draft only: package/latest release are still 0.16.2. Parent must verify gates and authorize any release claim.

## UI-only setup

Run `bruv web` for instructions; it does not download, configure, or start T3. Install official T3 separately and start it normally, with no custom startup arguments or parent environment. In **Settings > Providers**, add a separate **Claude** provider named **Bruv** (do not change your real Claude provider):

- Binary: sibling `bruv-claude-compat` executable.
- Home: `~/.bruv/claude-compat-sdk` (T3 homePath / `CLAUDE_CONFIG_DIR`).
- Launch arguments: empty.
- Provider-only environment: `BRUV_CLAUDE_COMPAT_HOME=~/.bruv/agent` and `BRUV_CLAUDE_COMPAT_BRUV_PATH=<sibling bruv executable>`.

The setup reuses Bruv authentication, models, settings and resources; it does not copy secrets. Keep using normal `bruv` CLI. Add/select models by the exact provider/model IDs in Bruv's model registry; set a default in the selected Bruv home if needed. Do not use T3's Claude login/install/update actions or point T3 at `~/.claude`. For an isolated Bruv home, follow `bruv web`'s displayed paths and configure its auth/models separately.

## Fixes

- Local home, model and auth checks, plus paired-binary validation, run before native history or MCP resources are allocated.
- App-owned HTTP MCP leases are released before native idle and reacquired on the next turn; shutdown drains owned work before closing cleanly.

## Limits and update

The provider-scoped SDK history fix from upstream PR #15598 is not yet in an official T3 build. Older T3 forks may fail native fork before Bruv starts; Bruv cannot guarantee a graceful upstream response. The separate Claude product-version warning remains unresolved. This is not native desktop parity, a paid-model guarantee, or full T3/Claude UI parity.

Update the Bruv CLI and `bruv-claude-compat` pair to the same version; stop active Bruv/T3 sessions first. Existing user data is preserved; normal Bruv CLI use remains available. Do not claim a new release until the parent verifies the release gates and publishes.
