import { describe, expect, test } from "bun:test";
import {
  interactionBudgetFailures,
  samplePeakSync,
  summarizeInteraction,
  compareInteractions,
  validateInteractionRun,
  type InteractionRun,
} from "../scripts/terminal-perf/interaction-report";
import { escapeInteractionJson, interactionDashboard } from "../scripts/terminal-perf/interaction-dashboard";
import { parseInteractionOptions } from "../scripts/terminal-perf/interaction-options";
import { selectInteractionCases } from "../scripts/terminal-interactions";
import { normalizeInteraction } from "../scripts/terminal-perf/interaction-normalize";
import { reportFixture } from "./fixtures/terminal-interaction-report";
import { runInNewContext } from "node:vm";
describe("interaction evidence accounting", () => {
  test("never adds nested CPU, frame, elapsed or heartbeat", () => {
    const run = reportFixture(),
      s = run.cases[0].samples[0];
    expect(samplePeakSync(s)).toBe(7);
    expect(interactionBudgetFailures(run)).toEqual([]);
    expect(summarizeInteraction(run.cases[0], 8).ack?.max).toBe(1000);
    s.contiguousSyncMs = 12;
    s.boundary = "complete";
    expect(samplePeakSync(s)).toBe(12);
    expect(interactionBudgetFailures(run)).toEqual([run.cases[0].id]);
  });
  test("strictly less than budget; equality fails without clock assertions", () => {
    const run = reportFixture();
    run.budgetMs = 7;
    expect(interactionBudgetFailures(run)).toHaveLength(1);
  });
  test("comparison keeps fingerprints, parameters and scope honest", () => {
    const run = reportFixture(),
      before = structuredClone(run);
    before.environment.cpu = "other";
    before.sources.fingerprint = "old";
    before.cases[0].samples[0].contentHash = "old-content";
    before.cases[0].samples[0].screenHash = "old-screen";
    before.cases[0].samples[0].outputHash = "old-output";
    expect(compareInteractions(run, before).warnings.join(" ")).toContain("Output fingerprints");
    expect(compareInteractions(run, before).cases[0].contentDifferences).toBe(1);
    before.cases[0].scope = "different";
    expect(compareInteractions(run, before).cases).toEqual([]);
  });
  test("rejects malformed report evidence and timings", () => {
    for (const edit of [
      (r: InteractionRun) => r.cases.splice(0),
      (r: InteractionRun) => {
        r.budgetMs = NaN;
      },
      (r: InteractionRun) => {
        r.cases[0].samples[0].frameMs = [-1];
      },
      (r: InteractionRun) => {
        r.cases[0].samples[0].spans[0].durationMs = Infinity;
      },
      (r: InteractionRun) => {
        r.cases[0].samples[0].rawEvidence = "missing";
      },
      (r: InteractionRun) => {
        r.cases[0].samples[0].boundary = "complete";
      },
    ]) {
      const run = reportFixture();
      edit(run);
      expect(() => validateInteractionRun(run)).toThrow("Invalid interaction report");
    }
    expect(validateInteractionRun(reportFixture()).cases).toHaveLength(1);
  });
  test("offline dashboard escapes embedded JSON and includes raw samples/comparison", () => {
    const run = reportFixture(),
      hostile = "</script><img src=x onerror=alert(1)>&\u2028\u2029";
    run.cases[0].id = hostile;
    run.evidence["raw/test.json"] = { output: hostile };
    const html = interactionDashboard(run, reportFixture());
    expect(html).not.toContain(hostile);
    const embedded = html.match(/<script id="interaction-data" type="application\/json">([\s\S]*?)<\/script>/)![1];
    expect(JSON.parse(embedded).run.cases[0].id).toBe(hostile);
    expect(html).toContain("Complete raw fixture + profiler evidence");
    expect(html).not.toContain("innerHTML");
    expect(JSON.parse(escapeInteractionJson({ hostile }))).toEqual({ hostile });
  });
  test("dashboard JavaScript filters cases and drills into complete raw samples offline", () => {
    const run = reportFixture();
    const html = interactionDashboard(run, run);
    class Element {
      textContent = "";
      value: string | number = "";
      children: Element[] = [];
      className = "";
      onclick?: () => void;
      onchange?: () => void;
      oninput?: () => void;
      append(e: Element) {
        this.children.push(e);
      }
      replaceChildren() {
        this.children = [];
        this.value = "0";
      }
    }
    const elements = new Map<string, Element>();
    const get = (id: string) => {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id)!;
    };
    get("interaction-data").textContent = html.match(
      /<script id="interaction-data" type="application\/json">([\s\S]*?)<\/script>/,
    )![1];
    get("group").value = "all";
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
    runInNewContext(script, { document: { getElementById: get, createElement: () => new Element() }, Node: Element });
    expect(get("rows").children).toHaveLength(1);
    expect(get("raw").textContent).toContain("visible result");
    expect(get("slow").textContent).toContain("outer");
    get("group").value = "send";
    get("group").onchange!();
    expect(get("rows").children).toHaveLength(0);
    get("group").value = "all";
    get("filter").value = "short";
    get("filter").oninput!();
    expect(get("rows").children).toHaveLength(1);
  });
  test("tool normalization explicitly marks missing contiguous slice", () => {
    const sample = {
      stage: "reveal",
      segments: [
        { name: "one", durationMs: 3 },
        { name: "two", durationMs: 4 },
      ],
      mutationMs: 7,
      frames: [{ durationMs: 6 }],
      content: { hash: "x", renderer: "registered-execute", imageProcessing: "none" },
      screenHash: "s",
      outputHash: "o",
      work: {},
      changedRows: 1,
    };
    const normalized = normalizeInteraction("tools/short", { samples: [sample] }, 0, "raw/test.json")[0].samples[0];
    expect(normalized.boundary).toBe("missing");
    expect(samplePeakSync(normalized)).toBe(7);
    expect(normalized.limits.join(" ")).toContain("NOT mutation+frame total");
  });
});
describe("bounded CLI selection", () => {
  test("runnable catalog matches the current integrated fixture exports", async () => {
    const { toolShapes } = await import("../scripts/terminal-perf/tool-workloads");
    const { navigationModes } = await import("../scripts/terminal-perf/navigation-workloads");
    const cases = selectInteractionCases(parseInteractionOptions([]));
    expect(cases.filter((c) => c.startsWith("tools/") && !c.startsWith("tools/events/"))).toEqual(
      toolShapes.map((s) => "tools/" + s),
    );
    expect(cases.filter((c) => c.startsWith("navigation/") && c !== "navigation/lifecycle")).toEqual(
      navigationModes.map((m) => "navigation/" + m),
    );
  });
  test("defaults cover every shape, send paths, navigation and initialized lifecycle", () => {
    const cases = selectInteractionCases(parseInteractionOptions([]));
    expect(cases.filter((s) => s.startsWith("tools/") && !s.startsWith("tools/events/"))).toHaveLength(13);
    expect(cases.filter((s) => s.startsWith("tools/events/"))).toHaveLength(8);
    expect(cases).toContain("navigation/lifecycle");
    expect(cases).toContain("send/large-paste");
    expect(cases).toContain("send/steer");
    expect(cases).toContain("send/follow-up");
  });
  test("rejects bad numeric values, flags and selections", () => {
    for (const args of [
      ["--repetitions", "0"],
      ["--budget", "NaN"],
      ["--budget", "Infinity"],
      ["--height", "2"],
      ["--groups", "other"],
      ["--out"],
      ["--wat"],
    ])
      expect(() => parseInteractionOptions(args)).toThrow();
    expect(() => selectInteractionCases(parseInteractionOptions(["--cases", "tools/nope"]))).toThrow("Unknown case");
    expect(() =>
      selectInteractionCases(parseInteractionOptions(["--groups", "send", "--cases", "tools/short"])),
    ).toThrow("No cases");
    expect(selectInteractionCases(parseInteractionOptions(["--groups", "tools", "--cases", "tools/short"]))).toEqual([
      "tools/short",
    ]);
  });
});

test("saved report rejects absent timings, raw data and repetition coverage", () => {
  const missing = reportFixture();
  missing.cases[0].samples[0].spans = [];
  missing.cases[0].samples[0].frameMs = [];
  expect(() => validateInteractionRun(missing)).toThrow("no observed synchronous timing");
  const raw = reportFixture();
  raw.evidence["raw/test.json"] = null;
  expect(() => validateInteractionRun(raw)).toThrow("raw evidence");
  const incomplete = reportFixture();
  incomplete.config.repetitions = 2;
  expect(() => validateInteractionRun(incomplete)).toThrow("repetition coverage");
  incomplete.cases[0].samples.push(structuredClone(incomplete.cases[0].samples[0]));
  expect(() => validateInteractionRun(incomplete)).toThrow("repetition coverage");
});

test("baseline deltas require matched action, phase, iteration and measurement boundary", () => {
  const run = reportFixture();
  for (const key of ["action", "phase", "iteration", "boundary"] as const) {
    const old = structuredClone(run);
    Object.assign(old.cases[0].samples[0], { [key]: key === "iteration" ? 1 : "changed" });
    const comparison = compareInteractions(run, old);
    expect(comparison.cases).toEqual([]);
    expect(comparison.warnings.join(" ")).toContain("measurement boundary");
  }
});

test("input lateness stays an elapsed diagnostic, not synchronous CPU", () => {
  const run = reportFixture();
  run.cases[0].samples[0].inputLatenessMs = [40, 76];
  expect(summarizeInteraction(run.cases[0], 8).inputLateness?.max).toBe(76);
  expect(samplePeakSync(run.cases[0].samples[0])).toBe(7);
  expect(interactionBudgetFailures(run)).toEqual([]);
});
