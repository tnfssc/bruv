import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { dashboard } from "../scripts/terminal-perf/dashboard.js";
import { compareRuns, type FrameSample, type PerfRun } from "../scripts/terminal-perf/report.js";

function fixture(): PerfRun {
  const frame = (index: number, durationMs: number, phases: Record<string, number>): FrameSample => ({
    index,
    durationMs,
    phases,
    action: "type",
    bytes: 10,
    writes: 1,
    changed: true,
  });
  return {
    schemaVersion: 1,
    startedAt: "2026-10-05T00:00:00Z",
    budgetMs: 8,
    environment: {
      revision: "abc",
      dirty: true,
      bun: "1.4.2",
      platform: "linux",
      arch: "x64",
      cpu: "test",
      dependencies: {},
    },
    config: { samples: 3, warmup: 1, width: 120, height: 40, scales: [100] },
    cases: [
      {
        id: "first",
        description: "Typing",
        parameters: { scale: 100 },
        cold: [frame(0, 9, { coldOnly: 2 })],
        frames: [frame(0, 1, { layout: 8 }), frame(1, 8, { layout: 2 }), frame(2, 12, {})],
      },
      {
        id: "second",
        description: "Other case",
        parameters: { scale: 100 },
        cold: [frame(0, 3, { other: 1 })],
        frames: [frame(0, 2, { layout: 1 })],
      },
    ],
  };
}

// Only the DOM operations used by the offline script; no layout/paint emulation.
class Element {
  textContent: string | number = "";
  value = "";
  children: Element[] = [];
  attributes: Record<string, string> = {};
  className = "";
  tabIndex = -1;
  onclick?: () => void;
  onchange?: () => void;
  onmouseenter?: () => void;
  onkeydown?: (event: { key: string; preventDefault(): void }) => void;
  classList = {
    toggle: (name: string, enabled: boolean) => {
      this.className = enabled ? name : "";
    },
  };
  constructor(readonly tag: string) {}
  append(child: Element) {
    this.children.push(child);
    if (this.tag === "select" && this.children.length === 1) this.value = child.value;
  }
  replaceChildren() {
    this.children = [];
    if (this.tag === "select") this.value = "";
  }
  setAttribute(name: string, value: string | number) {
    this.attributes[name] = String(value);
  }
}

function openDashboard(html: string) {
  const elements = new Map<string, Element>();
  const get = (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element(["phase", "metric"].includes(id) ? "select" : "div"));
    return elements.get(id)!;
  };
  get("phase").value = "frames";
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  runInNewContext(script, {
    document: {
      getElementById: get,
      createElement: (tag: string) => new Element(tag),
      createElementNS: (_namespace: string, tag: string) => new Element(tag),
    },
  });
  return { get, bars: () => get("chart").children.filter((node) => node.tag === "rect") };
}

test("offline script keeps overview, chronological chart and total-duration spike ranking distinct", () => {
  const run = fixture();
  const before = JSON.stringify(run);
  const { get, bars } = openDashboard(dashboard(run));
  expect(get("budget").textContent).toBe("< 8 ms");
  expect(get("worst").textContent).toBe("12.000 ms");
  expect(get("count").textContent).toBe(6);
  expect(get("misses").textContent).toBe(3);
  expect(get("misses").className).toBe("bad");
  expect(get("cases").children.map((row) => row.children[5]!.className)).toEqual(["bad", "good"]);
  expect(get("metric").children.map((option) => option.value)).toEqual(["durationMs", "coldOnly", "layout"]);
  expect(bars().map((bar) => bar.attributes.fill)).toEqual(["#69e4c7", "#ff847d", "#ff847d"]);
  expect(bars().map((bar) => bar.children[0]!.textContent)).toEqual([
    "#0 type: 1.000 ms",
    "#1 type: 8.000 ms",
    "#2 type: 12.000 ms",
  ]);
  const slowest = get("slow").textContent;
  expect(
    String(slowest)
      .split("\n")
      .filter((line) => line.startsWith("#")),
  ).toEqual(["#2 type · 12.000 ms", "#1 type · 8.000 ms", "#0 type · 1.000 ms"]);
  get("metric").value = "layout";
  get("metric").onchange!();
  expect(bars().map((bar) => bar.attributes.fill)).toEqual(["#ff847d", "#69e4c7", "#69e4c7"]);
  expect(bars()[2]!.children[0]!.textContent).toBe("#2 type: 0.000 ms");
  expect(get("slow").textContent).toBe(slowest);
  bars()[0]!.onmouseenter!();
  expect(get("tooltip").textContent).toBe("#0 type · 8.000 ms · 10 bytes / 1 writes · changed=true · work={}");
  expect(get("chart").children.find((node) => node.tag === "line")!.attributes).toMatchObject({
    x1: "40",
    x2: "990",
    y1: "58",
    y2: "58",
  });
  expect(JSON.stringify(run)).toBe(before);
});

test("case selection retains cold/steady phase, resets metric and supports click/keyboard", () => {
  const { get, bars } = openDashboard(dashboard(fixture()));
  get("phase").value = "cold";
  get("phase").onchange!();
  expect(bars()[0]!.children[0]!.textContent).toBe("#0 type: 9.000 ms");
  get("metric").value = "coldOnly";
  get("metric").onchange!();
  expect(bars()[0]!.children[0]!.textContent).toBe("#0 type: 2.000 ms");
  const rows = get("cases").children;
  rows[1]!.onclick!();
  expect(get("phase").value).toBe("cold");
  expect(get("metric").value).toBe("durationMs");
  expect(get("metric").children.map((option) => option.value)).toEqual(["durationMs", "other", "layout"]);
  expect(get("case-title").textContent).toBe("second");
  expect(rows.map((row) => row.className)).toEqual(["", "selected"]);
  expect(bars()[0]!.children[0]!.textContent).toBe("#0 type: 3.000 ms");
  for (const key of ["Enter", " "]) {
    let prevented = false;
    rows[0]!.onkeydown!({
      key,
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
    expect(get("case-title").textContent).toBe("first");
    rows[1]!.onclick!();
  }
  rows[0]!.onkeydown!({
    key: "Escape",
    preventDefault: () => {
      throw new Error("unhandled key");
    },
  });
  expect(get("case-title").textContent).toBe("second");
});

test("baseline warnings and hostile strings survive as text in the offline document", () => {
  const run = fixture(),
    baseline = fixture();
  run.cases[0]!.description = "</script><script>alert(1)</script> literal $& \u2028 \u2029";
  baseline.environment.cpu = "other";
  baseline.cases.reverse();
  const html = dashboard(run, baseline);
  expect(html.match(/<script>/g)).toHaveLength(1);
  expect(html).not.toContain(run.cases[0]!.description);
  expect(html).toContain("\\u003c/script>");
  expect(html).toContain("\\u2028");
  expect(html).toContain("\\u2029");
  const { get } = openDashboard(html);
  expect(get("description").textContent).toBe(run.cases[0]!.description);
  expect(JSON.parse(String(get("compare").textContent))).toEqual(compareRuns(run, baseline));
  expect(String(get("compare").textContent)).toContain("cold delta suppressed");
  expect(String(openDashboard(dashboard(run)).get("compare").textContent)).toContain("No baseline supplied.");
});

test("slowest frames retain stable total-duration ties, cap at five and do not reorder the chart", () => {
  const run = fixture();
  run.cases[0]!.frames = [1, 8, 8, 4, 2, 3].map((durationMs, index) => ({
    ...run.cases[0]!.frames[0]!,
    durationMs,
    index,
  }));
  const { get, bars } = openDashboard(dashboard(run));
  expect(bars().map((bar) => bar.children[0]!.textContent)).toEqual([
    "#0 type: 1.000 ms",
    "#1 type: 8.000 ms",
    "#2 type: 8.000 ms",
    "#3 type: 4.000 ms",
    "#4 type: 2.000 ms",
    "#5 type: 3.000 ms",
  ]);
  expect(
    String(get("slow").textContent)
      .split("\n")
      .filter((line) => line.startsWith("#")),
  ).toEqual([
    "#1 type · 8.000 ms",
    "#2 type · 8.000 ms",
    "#3 type · 4.000 ms",
    "#5 type · 3.000 ms",
    "#4 type · 2.000 ms",
  ]);
});
