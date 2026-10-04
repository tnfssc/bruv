# v0.16.3: UI-only setup and MCP shutdown

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
