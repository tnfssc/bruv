# Installed provider initialization — 2026-10-04

User saw Limited / could not verify Claude authentication and the separate version warning. Inspected only non-secret fields in local T3 userdata settings and Bruv model/auth presence. Both installed binaries report0.16.3.

The Bruv provider environment used literal tilde paths for BRUV_CLAUDE_COMPAT_HOME and BRUV_CLAUDE_COMPAT_BRUV_PATH. Environment strings are not shell-expanded. Its custom model was gpt-6.1-sol without provider prefix. The normal Bruv agent home has an openai-codex default/auth entry; the separate default connector home has no model/auth.

Actual installed binary plus SDK0.3.276 initialize-only probe (no user prompt/MCP/provider call) reproduced the missing paired executable diagnostic with current env. Absolute provider paths initialized successfully for the configured default and explicit openai-codex/gpt-6.1-sol, reporting configured:true and access_verified:false. No paid-provider response/auth-validity or desktop UI refresh claim. No T3 settings were changed. The warning comparing Bruv product0.16.3 with Claude>=2.1.280 remains separate.

Tell the user to use absolute provider settings paths and the full model ID. Keep secrets in the existing Bruv home, not T3 fields. Repro script is local .cache/bruv-installed-init-probe.mjs; no secrets copied into the note. Existing values cover proof/identity; values unchanged.
