import { distribution, type PerfRun } from "./report.js";

export interface InteractionSpan {
  name: string;
  durationMs: number;
  kind: "sync" | "async-prefix" | "frame";
  startedAtMs?: number;
  endedAtMs?: number;
  depth?: number;
  parentId?: number | null;
  exclusiveMs?: number;
}
export interface InteractionSample {
  action: string;
  iteration: number;
  spans: InteractionSpan[];
  /** Known non-overlapping work in a synchronous mutation batch. Not awaited elapsed time. */
  mutationBatchMs?: number;
  frameMs: number[];
  firstVisibleAckMs?: number | null;
  firstProviderAdmissionMs?: number | null;
  requestToFrameMs?: number | null;
  providerWaitMs?: number[];
  heartbeatDelayMs?: number[];
  heartbeatGapMs?: number[];
  /** Queued input timer lateness. Elapsed diagnostic, never CPU. */
  inputLatenessMs?: number[];
  changedRows?: number;
  outputBytes?: number;
  outputWrites?: number;
  visible?: boolean;
  contentHash: string;
  screenHash: string;
  outputHash: string;
  work: Record<string, number>;
  rawEvidence: string;
  phase: "cold" | "init" | "action";
  boundary: "complete" | "separate-turns" | "missing";
  /** A measured full contiguous slice, only when both boundaries are observed. */
  contiguousSyncMs?: number;
  elapsedMs?: number;
  limits: string[];
}
export interface InteractionCase {
  id: string;
  group: "send" | "tools" | "navigation";
  scope: string;
  parameters: Record<string, string | number | boolean>;
  samples: InteractionSample[];
}
export interface InteractionRun {
  schemaVersion: "terminal-interactions-v1";
  startedAt: string;
  budgetMs: number;
  environment: PerfRun["environment"];
  config: { repetitions: number; width: number; height: number };
  cases: InteractionCase[];
  sources: { fingerprint: string; hashes: Record<string, string> };
  /** Complete raw fixture and profiler snapshots, also written separately on disk. */
  evidence: Record<string, unknown>;
  limits: string[];
}
const max = (values: number[]) => values.reduce((largest, value) => Math.max(largest, value), 0);
/** Inclusive spans may nest. Never add them or turn promise wait into CPU time. */
export function samplePeakSync(sample: InteractionSample): number {
  return max([
    sample.contiguousSyncMs ?? 0,
    sample.mutationBatchMs ?? 0,
    ...sample.frameMs,
    ...sample.spans.map((span) => span.durationMs),
  ]);
}
export function summarizeInteraction(result: InteractionCase, budgetMs: number) {
  if (!result.samples.length) throw new Error("Interaction case has no samples: " + result.id);
  const frames = result.samples.flatMap((sample) => sample.frameMs);
  const mutation = result.samples.map((sample) =>
    max([
      sample.mutationBatchMs ?? 0,
      ...sample.spans.filter((span) => span.kind !== "frame").map((span) => span.durationMs),
    ]),
  );
  const nullable = (values: number[]) => (values.length ? distribution(values, budgetMs) : null);
  return {
    peakSync: distribution(result.samples.map(samplePeakSync), budgetMs),
    mutation: distribution(mutation, budgetMs),
    frames: nullable(frames),
    ack: nullable(
      result.samples.flatMap((sample) => (sample.firstVisibleAckMs == null ? [] : [sample.firstVisibleAckMs])),
    ),
    providerAdmission: nullable(
      result.samples.flatMap((sample) =>
        sample.firstProviderAdmissionMs == null ? [] : [sample.firstProviderAdmissionMs],
      ),
    ),
    heartbeatDelay: nullable(result.samples.flatMap((sample) => sample.heartbeatDelayMs ?? [])),
    heartbeatGap: nullable(result.samples.flatMap((sample) => sample.heartbeatGapMs ?? [])),
    inputLateness: nullable(result.samples.flatMap((sample) => sample.inputLatenessMs ?? [])),
    changedSamples: result.samples.filter((sample) => (sample.changedRows ?? 0) > 0 || sample.visible).length,
    worst: [...result.samples].sort((a, b) => samplePeakSync(b) - samplePeakSync(a)).slice(0, 5),
  };
}
export function interactionBudgetFailures(run: InteractionRun): string[] {
  return run.cases
    .filter((result) => summarizeInteraction(result, run.budgetMs).peakSync.overBudget > 0)
    .map((result) => result.id);
}
export function compareInteractions(current: InteractionRun, baseline: InteractionRun) {
  const warnings: string[] = [];
  for (const key of ["bun", "platform", "arch", "cpu", "dependencies"] as const) {
    if (JSON.stringify(current.environment[key]) !== JSON.stringify(baseline.environment[key]))
      warnings.push("Different " + key);
  }
  if (JSON.stringify(current.config) !== JSON.stringify(baseline.config)) warnings.push("Different run config");
  if (current.sources.fingerprint !== baseline.sources.fingerprint)
    warnings.push("Different source fingerprints (inspect saved hashes)");
  const cases = current.cases.flatMap((result) => {
    const old = baseline.cases.find((entry) => entry.id === result.id);
    if (!old) {
      warnings.push("No baseline for " + result.id);
      return [];
    }
    if (JSON.stringify(result.parameters) !== JSON.stringify(old.parameters)) {
      warnings.push("Different parameters for " + result.id);
      return [];
    }
    if (result.scope !== old.scope) {
      warnings.push("Different measured scope for " + result.id);
      return [];
    }
    const sampleIdentity = (sample: InteractionSample) => [
      sample.iteration,
      sample.action,
      sample.phase,
      sample.boundary,
    ];
    if (JSON.stringify(result.samples.map(sampleIdentity)) !== JSON.stringify(old.samples.map(sampleIdentity))) {
      warnings.push("Different sample identity or measurement boundary for " + result.id);
      return [];
    }
    const contentDifferences = result.samples.filter(
      (sample, i) => old.samples[i] && sample.contentHash !== old.samples[i].contentHash,
    ).length;
    const outputDifferences = result.samples.filter(
      (sample, i) => old.samples[i] && sample.outputHash !== old.samples[i].outputHash,
    ).length;
    if (outputDifferences) warnings.push("Output fingerprints differ for " + result.id);
    const screenDifferences = result.samples.filter(
      (sample, i) => old.samples[i] && sample.screenHash !== old.samples[i].screenHash,
    ).length;
    if (contentDifferences) warnings.push("Input/content fingerprints differ for " + result.id);
    if (screenDifferences)
      warnings.push(
        "Screen fingerprints differ for " + result.id + " (scheduled UI may be time-dependent; inspect raw evidence)",
      );
    const now = summarizeInteraction(result, current.budgetMs),
      before = summarizeInteraction(old, current.budgetMs);
    return [
      {
        id: result.id,
        peakP95DeltaMs: now.peakSync.p95 - before.peakSync.p95,
        peakMaxDeltaMs: now.peakSync.max - before.peakSync.max,
        mutationMaxDeltaMs: now.mutation.max - before.mutation.max,
        frameMaxDeltaMs: now.frames && before.frames ? now.frames.max - before.frames.max : null,
        contentDifferences,
        screenDifferences,
        outputDifferences,
      },
    ];
  });
  for (const old of baseline.cases)
    if (!current.cases.some((entry) => entry.id === old.id)) warnings.push("Not run: " + old.id);
  return { warnings, cases };
}
const ms = (value: number | null | undefined) => (value == null ? "n/a" : value.toFixed(3));
export function interactionTextReport(run: InteractionRun, baseline?: InteractionRun) {
  const lines = [
    "Observed synchronous-scope budget: < " + run.budgetMs + " ms",
    "Case | mutation lower-bound max | frame max | observed sync p95/max | misses | visible ack max (elapsed) | loop delay max | input lateness max",
    ...run.cases.map((result) => {
      const s = summarizeInteraction(result, run.budgetMs);
      return [
        result.id,
        ms(s.mutation.max),
        ms(s.frames?.max),
        ms(s.peakSync.p95) + "/" + ms(s.peakSync.max),
        s.peakSync.overBudget + "/" + s.peakSync.count,
        ms(s.ack?.max),
        ms(s.heartbeatDelay?.max),
        ms(s.inputLateness?.max),
      ].join(" | ");
    }),
  ];
  const failures = interactionBudgetFailures(run);
  lines.push(
    failures.length
      ? "OBSERVED CPU MISSES: " + failures.join(", ")
      : "All observed synchronous scopes under budget; unobserved work is NOT proven.",
  );
  lines.push(
    ...run.limits,
    ...run.cases
      .filter((c) => c.samples.some((s) => s.boundary === "missing"))
      .map((c) => "MISSING contiguous boundary: " + c.id),
  );
  lines.push(
    "Inclusive/nested spans are not added. Async-prefix timing excludes continuations unless separately observed.",
    "Acknowledgment, admission, request delay, provider timers and heartbeat gaps are NOT CPU duration.",
    "Counting terminal and recording provider; no emulator paint, network or all-app latency guarantee.",
  );
  if (baseline) {
    const comparison = compareInteractions(run, baseline);
    lines.push(
      "",
      "Baseline deltas (positive = slower):",
      ...comparison.warnings.map((warning) => "WARNING: " + warning),
      ...comparison.cases.map(
        (entry) =>
          entry.id +
          ": sync p95 " +
          ms(entry.peakP95DeltaMs) +
          ", sync max " +
          ms(entry.peakMaxDeltaMs) +
          ", mutation max " +
          ms(entry.mutationMaxDeltaMs) +
          ", frame max " +
          ms(entry.frameMaxDeltaMs),
      ),
    );
  }
  return lines.join(String.fromCharCode(10)) + String.fromCharCode(10);
}

/** Validate the portable data actually consumed by summaries/dashboard; raw evidence is opaque. */
export function validateInteractionRun(value: unknown): InteractionRun {
  const fail = (where: string): never => {
    throw new Error("Invalid interaction report: " + where);
  };
  const obj = (v: unknown, where: string): Record<string, unknown> => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return fail(where);
    return v as Record<string, unknown>;
  };
  const number = (v: unknown, where: string, positive = false) => {
    if (typeof v !== "number" || !Number.isFinite(v) || (positive ? v <= 0 : v < 0)) fail(where);
  };
  const strings = (v: unknown, where: string) => {
    if (!Array.isArray(v) || v.some((s) => typeof s !== "string")) fail(where);
  };
  const mapStrings = (v: unknown, where: string) => {
    if (Object.values(obj(v, where)).some((s) => typeof s !== "string")) fail(where);
  };
  const numbers = (v: unknown, where: string) => {
    if (!Array.isArray(v)) return fail(where);
    for (const n of v) number(n, where);
  };
  const r = obj(value, "root");
  if (
    r.schemaVersion !== "terminal-interactions-v1" ||
    typeof r.startedAt !== "string" ||
    !Number.isFinite(Date.parse(r.startedAt))
  )
    fail("schema/date");
  number(r.budgetMs, "budget", true);
  const env = obj(r.environment, "environment");
  for (const key of ["revision", "bun", "platform", "arch", "cpu"])
    if (typeof env[key] !== "string") fail("environment." + key);
  if (typeof env.dirty !== "boolean") fail("environment.dirty");
  mapStrings(env.dependencies, "dependencies");
  const config = obj(r.config, "config");
  for (const key of ["repetitions", "width", "height"]) {
    number(config[key], "config." + key, true);
    if (!Number.isSafeInteger(config[key])) fail("config integer");
  }
  const sources = obj(r.sources, "sources");
  if (typeof sources.fingerprint !== "string") fail("source fingerprint");
  mapStrings(sources.hashes, "source hashes");
  const evidence = obj(r.evidence, "evidence");
  strings(r.limits, "limits");
  if (!Array.isArray(r.cases) || !r.cases.length) fail("empty cases");
  const ids = new Set();
  for (const entry of r.cases as unknown[]) {
    const c = obj(entry, "case");
    if (typeof c.id !== "string" || !c.id || ids.has(c.id)) fail("case id");
    ids.add(c.id);
    if (!["send", "tools", "navigation"].includes(c.group as string) || typeof c.scope !== "string")
      fail("case scope/group");
    for (const v of Object.values(obj(c.parameters, "parameters")))
      if (!["string", "number", "boolean"].includes(typeof v) || (typeof v === "number" && !Number.isFinite(v)))
        fail("parameter");
    if (!Array.isArray(c.samples) || !c.samples.length) fail("empty samples");
    if ((c.samples as unknown[]).length !== config.repetitions) fail("incomplete repetition coverage");
    const iterations = new Set<number>();
    for (const entry of c.samples as unknown[]) {
      const s = obj(entry, "sample");
      for (const key of ["action", "contentHash", "screenHash", "outputHash", "rawEvidence"])
        if (typeof s[key] !== "string") fail("sample." + key);
      if (!Object.hasOwn(evidence, s.rawEvidence as string)) fail("missing raw evidence");
      obj(evidence[s.rawEvidence as string], "raw evidence");
      if (
        !["cold", "init", "action"].includes(s.phase as string) ||
        !["complete", "separate-turns", "missing"].includes(s.boundary as string)
      )
        fail("sample phase/boundary");
      if (s.boundary === "complete" && s.contiguousSyncMs == null) fail("complete boundary without duration");
      number(s.iteration, "iteration");
      if (!Number.isSafeInteger(s.iteration)) fail("iteration integer");
      if ((s.iteration as number) >= (config.repetitions as number) || iterations.has(s.iteration as number))
        fail("invalid repetition coverage");
      iterations.add(s.iteration as number);
      strings(s.limits, "sample limits");
      numbers(s.frameMs, "frames");
      for (const key of [
        "contiguousSyncMs",
        "mutationBatchMs",
        "elapsedMs",
        "firstVisibleAckMs",
        "firstProviderAdmissionMs",
        "requestToFrameMs",
        "changedRows",
        "outputBytes",
        "outputWrites",
      ])
        if (s[key] != null) number(s[key], key);
      for (const key of ["providerWaitMs", "heartbeatDelayMs", "heartbeatGapMs", "inputLatenessMs"])
        if (s[key] !== undefined) numbers(s[key], key);
      for (const n of Object.values(obj(s.work, "work"))) number(n, "work value");
      if (s.visible !== undefined && typeof s.visible !== "boolean") fail("visible");
      if (!Array.isArray(s.spans)) fail("spans");
      if (
        !(s.spans as unknown[]).length &&
        !(s.frameMs as number[]).length &&
        s.contiguousSyncMs == null &&
        s.mutationBatchMs == null
      )
        fail("sample has no observed synchronous timing");
      for (const entry of s.spans as unknown[]) {
        const p = obj(entry, "span");
        if (typeof p.name !== "string" || !["sync", "async-prefix", "frame"].includes(p.kind as string))
          fail("span name/kind");
        for (const key of ["durationMs", "startedAtMs", "endedAtMs", "depth", "exclusiveMs"])
          if (key === "durationMs" || p[key] !== undefined) number(p[key], "span." + key);
        if (typeof p.startedAtMs === "number" && typeof p.endedAtMs === "number" && p.endedAtMs < p.startedAtMs)
          fail("span reversed bounds");
      }
    }
  }
  return value as InteractionRun;
}
