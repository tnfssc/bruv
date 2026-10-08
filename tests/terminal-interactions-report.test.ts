import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { selectInteractionCases } from "../scripts/terminal-interactions";
import { escapeInteractionJson, interactionDashboard } from "../scripts/terminal-perf/interaction-dashboard";
import { normalizeInteraction } from "../scripts/terminal-perf/interaction-normalize";
import { parseInteractionOptions } from "../scripts/terminal-perf/interaction-options";
import {
  compareInteractions,
  type InteractionRun,
  interactionBudgetFailures,
  samplePeakSync,
  summarizeInteraction,
  validateInteractionRun,
} from "../scripts/terminal-perf/interaction-report";
import { reportFixture } from "./fixtures/terminal-interaction-report";

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

  test("input lateness stays an elapsed diagnostic, not synchronous CPU", () => {
    const run = reportFixture();
    run.cases[0].samples[0].inputLatenessMs = [40, 76];
    expect(summarizeInteraction(run.cases[0], 8).inputLateness?.max).toBe(76);
    expect(samplePeakSync(run.cases[0].samples[0])).toBe(7);
    expect(interactionBudgetFailures(run)).toEqual([]);
  });
});

describe("baseline comparison", () => {
  test("fingerprint differences warn, but scope mismatch excludes deltas", () => {
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

  test.each(["action", "phase", "iteration", "boundary"] as const)("baseline deltas require matched %s", (key) => {
    const run = reportFixture();

    const old = structuredClone(run);
    Object.assign(old.cases[0].samples[0], { [key]: key === "iteration" ? 1 : "changed" });
    const comparison = compareInteractions(run, old);
    expect(comparison.cases).toEqual([]);
    expect(comparison.warnings.join(" ")).toContain("measurement boundary");
  });
});

describe("saved report validation", () => {
  test("accepts the portable report fixture", () => {
    expect(validateInteractionRun(reportFixture()).cases).toHaveLength(1);
  });

  const malformedReports: { name: string; edit: (run: InteractionRun) => void }[] = [
    {
      name: "empty cases",
      edit: (run) => {
        run.cases.splice(0);
      },
    },
    {
      name: "nonfinite budget",
      edit: (run) => {
        run.budgetMs = NaN;
      },
    },
    {
      name: "negative frame duration",
      edit: (run) => {
        run.cases[0].samples[0].frameMs = [-1];
      },
    },
    {
      name: "nonfinite span duration",
      edit: (run) => {
        run.cases[0].samples[0].spans[0].durationMs = Infinity;
      },
    },
    {
      name: "missing raw evidence reference",
      edit: (run) => {
        run.cases[0].samples[0].rawEvidence = "missing";
      },
    },
    {
      name: "complete boundary without duration",
      edit: (run) => {
        run.cases[0].samples[0].boundary = "complete";
      },
    },
  ];

  test.each(malformedReports)("rejects $name", ({ edit }) => {
    const run = reportFixture();
    edit(run);
    expect(() => validateInteractionRun(run)).toThrow("Invalid interaction report");
  });

  test("rejects samples with no observed synchronous timing", () => {
    const run = reportFixture();
    const sample = run.cases[0].samples[0];
    sample.spans = [];
    sample.frameMs = [];
    expect(() => validateInteractionRun(run)).toThrow("no observed synchronous timing");
  });

  test("rejects null raw evidence", () => {
    const run = reportFixture();
    run.evidence["raw/test.json"] = null;
    expect(() => validateInteractionRun(run)).toThrow("raw evidence");
  });

  test("rejects missing repetitions", () => {
    const run = reportFixture();
    run.config.repetitions = 2;
    expect(() => validateInteractionRun(run)).toThrow("repetition coverage");
  });

  test("rejects duplicated iterations even with the requested sample count", () => {
    const run = reportFixture();
    run.config.repetitions = 2;
    run.cases[0].samples.push(structuredClone(run.cases[0].samples[0]));
    expect(() => validateInteractionRun(run)).toThrow("repetition coverage");
  });

  test("validation preserves portable values and opaque evidence without normalization", () => {
    const run = reportFixture();
    run.config.repetitions = 2;
    const sample = run.cases[0].samples[0];
    sample.iteration = 1;
    sample.firstVisibleAckMs = null;
    sample.firstProviderAdmissionMs = null;
    sample.requestToFrameMs = null;
    sample.spans = [{ name: "prefix", kind: "async-prefix", durationMs: 0, parentId: null }];
    run.cases[0].samples.push({ ...structuredClone(sample), iteration: 0 });
    const second = structuredClone(run.cases[0]);
    second.id = "tools/second/reveal";
    run.cases.push(second);
    run.evidence["raw/test.json"] = { fixtureSpecific: [null, "opaque", { nested: true }] };
    const before = structuredClone(run);
    expect(validateInteractionRun(run)).toBe(run);
    expect(run).toEqual(before);
  });

  test("validation keeps identity and repetition diagnostics ahead of nested measurements", () => {
    const duplicate = reportFixture();
    const second = structuredClone(duplicate.cases[0]);
    second.samples[0].frameMs = [-1];
    duplicate.cases.push(second);
    expect(() => validateInteractionRun(duplicate)).toThrow("Invalid interaction report: case id");

    const repetition = reportFixture();
    repetition.cases[0].samples[0].iteration = 1;
    repetition.cases[0].samples[0].frameMs = [-1];
    expect(() => validateInteractionRun(repetition)).toThrow("Invalid interaction report: invalid repetition coverage");
  });

  test("validation checks optional span bounds after required timing", () => {
    const run = reportFixture();
    const span = run.cases[0].samples[0].spans[0];
    span.startedAtMs = 10;
    span.endedAtMs = 9;
    expect(() => validateInteractionRun(run)).toThrow("Invalid interaction report: span reversed bounds");
    span.durationMs = -1;
    expect(() => validateInteractionRun(run)).toThrow("Invalid interaction report: span.durationMs");
  });
});

describe("offline dashboard", () => {
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
});

describe("tool measurement boundary", () => {
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
