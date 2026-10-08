import type { InteractionRun } from "../../../scripts/terminal-perf/interaction-report";
export function reportFixture(): InteractionRun {
  return {
    schemaVersion: "terminal-interactions-v1",
    startedAt: "2026-10-05T00:00:00Z",
    budgetMs: 8,
    environment: {
      revision: "abc",
      dirty: false,
      bun: "1",
      platform: "linux",
      arch: "x64",
      cpu: "test",
      dependencies: {},
    },
    sources: { fingerprint: "test", hashes: {} },
    config: { repetitions: 1, width: 100, height: 32 },
    limits: ["limited fixture"],
    evidence: { "raw/test.json": { output: "visible result" } },
    cases: [
      {
        id: "tools/short/reveal",
        group: "tools",
        scope: "test seam",
        parameters: { shape: "short" },
        samples: [
          {
            action: "reveal",
            iteration: 0,
            phase: "action",
            boundary: "missing",
            limits: ["missing mutation+frame boundary"],
            spans: [
              { name: "outer", durationMs: 7, kind: "sync", depth: 0 },
              { name: "inner", durationMs: 6, kind: "sync", depth: 1 },
            ],
            frameMs: [5],
            contentHash: "content",
            screenHash: "screen",
            outputHash: "output",
            changedRows: 1,
            work: { renders: 1 },
            rawEvidence: "raw/test.json",
            elapsedMs: 1000,
            firstVisibleAckMs: 1000,
            providerWaitMs: [900],
            heartbeatDelayMs: [99],
          },
        ],
      },
    ],
  };
}
