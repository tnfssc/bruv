# Offline resource investigation probes

See [the historical audit report](../../wisdom/resources/memory-resource-audit.md) for results and limitations. These are manual investigation harnesses, not release gates. No API/device/live probe is part of this move.

## Maintained offline entry points (left under scripts)

- `session-journal.ts`: synthetic history retention and reset/GC.
- `bridge-retention.ts`: in-memory bridge requests and listener/heap counts.
- `execution-runtime.ts`: execute success, spill, timeout, abort, owned-descendant cleanup.
- `cli-rpc-soak.ts`: CLI using a local fake model; optional `BRUV_SOAK_CYCLES` and `BRUV_SOAK_NEW_ONLY`.

These probes do not assert an old web source pin. The old bundled T3 launcher
and RPC gates were retired with `integrations/`. Generic CLI probes remain here.
Current external T3 release validation uses `scripts/run-native-release-gate.mjs`.

## Historical web evidence (retired inputs; retained results)

The historical `current-web-*`, `bundled-web-runtime.mjs`, `web-runtime-probe.mjs`, and `server-shutdown-probe.mjs` were retired from the checkout; [production-v2 recovery instructions](../../wisdom/experiments/t3/production-v2/README.md) retain their exact Git baseline. The first group hardcodes old pin `719a76ca1dbf5490f1aa33ffb9966301e02be9a9` and/or its `.cache/die-t3code-v0042` checkout and `web/t3.patch`; “current” was historical, not a claim about today's canonical pin. The last two use the older `.cache/die-t3code` checkout. The old `scripts/die-web-{mode,model,smoke,stop}-smoke.ts` were retired alongside them because they also use `.cache/die-t3code`. Historical prose and evidence remain unchanged. Recovered scripts retain their old source-relative paths; port and revalidate against the current source before reuse. Prior measurements remain historical, not current-release assertions.

Use the maintained product tests and external T3 release checks for production behavior. Preserve exact owned-PID cleanup in any adapted harness; do not replace it with process-name matching, pkill, or killall. RSS alone is not proof of a live-object leak.
