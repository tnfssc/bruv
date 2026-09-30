# Move the work, not just the checks

On 2026-09-30 the user repeatedly said this CI work moved too slowly. They asked for more parallel work and to cut the right corners. The parent had kept adding serial review, measurement and full-test rounds after focused proof was already available. That was needless delay.

Start independent implementation, focused review and measurement setup together. Integrate once the relevant checks pass. Run hosted full validation beside isolated timing probes, not before them. A separate bug can have its own owner; do not let it take over the requested goal. Keep one owner for each edit area.

Use focused regression checks for a small CI-runner change, plus the normal hosted gate. Do not rerun the whole local suite after each small fix. Repeat broader checks when the changed boundary warrants it. This saves time, not assertions.

Keep failures visible. Never drop tests just to hit the time target. Report selected validation as selected, and count queue/setup/final-status time. Do not call one good run a p95 promise. Extra coordination and status messages are not progress.
