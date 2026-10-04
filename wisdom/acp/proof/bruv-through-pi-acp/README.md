# Bruv through pi-acp: sanitized research proof

2026-10-03. This is a real published-adapter/compiled-engine protocol test with a deterministic loopback model, not live-model quality or T3/browser acceptance. No actual credentials.

- identity.json: exact registry entry, tarball/runtime/engine hashes and dependency/runtime identities.
- acp-trace.ndjson: complete ACP tx/rx and driver checkpoints; only absolute repo path changed to <repo>. Includes replay on load/restart.
- local-provider-inputs.ndjson: actual Responses inputs, model IDs and available tool names; system instructions omitted, no invented provider calls.
- result.json: all 12 steps, root session ID, isolated environment and idle updates.
- validation-summary.json: computed ordering, cancellation timing, resume and synthetic credential facts.
- shell-job-events.ndjson / execute-proof.txt: compiled Bruv's actual job lifecycle journal and actual written file.
- synthetic-credential-trace.ndjson: actual unchanged adapter + compiled Bruv shell showing propagation of **synthetic only** T3_ACP_MCP_* values.
- driver.mjs / synthetic-credential-driver.mjs: research fixtures. They never rebuild Bruv, never invoke a paid provider, and construct a child environment instead of inheriting the researcher environment.

## Reproduction

From repository root, use an existing executable dist/bruv. Start with a fresh owned .cache/acp-bruv-wrapper. Copy driver.mjs there. Obtain pi-acp-0.0.34.tgz from the identity URL and verify the recorded hashes; extract it there to package/. Supply only its three runtime dependencies in package/node_modules (actual run copied the already-installed peer dependency tree). **Do not rebuild or edit package/dist/index.js.**

Run:

`env -i PATH=/usr/bin:/bin HOME="$PWD/.cache/acp-bruv-wrapper/home" /usr/bin/node .cache/acp-bruv-wrapper/driver.mjs`

The driver creates the isolated model settings, starts an ephemeral loopback HTTP endpoint, runs bounded protocol probes and closes its adapter/server. Raw evidence appears in that owned cache. No T3 server is launched. For the synthetic boundary probe, copy synthetic-credential-driver.mjs to .cache/acp-bruv-wrapper/credential-probe/ and run the same env-i command against that script with HOME under credential-probe/home. Its endpoint/authorization strings are explicitly fake; never substitute real credentials.

The durable traces are from the original run; re-running uses fresh session IDs and timestamps. They do not require private cache files to interpret. See ../../bruv-through-pi-acp.md for scope, known gaps and why direct T3 was not attempted.
