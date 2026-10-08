import { describe, expect, test } from "bun:test";
import { createContext, runInContext } from "node:vm";
import { interactionDashboard } from "../scripts/terminal-perf/interaction-dashboard";
import { compareInteractions, type InteractionRun } from "../scripts/terminal-perf/interaction-report";
import { reportFixture } from "./fixtures/terminal-interaction-report";

// Only the DOM operations used by this offline dashboard; not a browser/paint test.
class Element {
  textContent = "";
  value: string | number = "";
  className = "";
  children: Element[] = [];
  onclick?: () => void;
  onchange?: () => void;
  oninput?: () => void;
  constructor(readonly tag = "") {}
  append(child: Element) {
    this.children.push(child);
    if (this.tag === "select" && this.children.length === 1) this.value = child.value;
  }
  replaceChildren() {
    this.children = [];
    this.value = "";
  }
}

function openDashboard(run: InteractionRun, baseline?: InteractionRun) {
  const html = interactionDashboard(run, baseline);
  const elements = new Map<string, Element>();
  const get = (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element(id === "samples" ? "select" : ""));
    return elements.get(id)!;
  };
  get("interaction-data").textContent = html.match(
    /<script id="interaction-data" type="application\/json">([\s\S]*?)<\/script>/,
  )![1];
  get("group").value = "all";
  const context = createContext({
    document: { getElementById: get, createElement: (tag: string) => new Element(tag) },
    Node: Element,
  });
  runInContext(html.match(/<script>([\s\S]*?)<\/script>/)![1], context);
  // Rendering consumes this parsed copy, not the original run passed to the HTML generator.
  const browserData = runInContext("data", context);
  return { get, html, browserData };
}

function repeatedCases(): InteractionRun {
  const run = reportFixture();
  run.config.repetitions = 2;
  const first = run.cases[0].samples[0];
  first.frameMs = [];
  const second = structuredClone(first);
  second.iteration = 1;
  second.boundary = "complete";
  second.contiguousSyncMs = 0;
  second.spans = Array.from({ length: 30 }, (_, i) => ({ name: "span " + i, durationMs: i, kind: "sync", depth: 0 }));
  second.frameMs = [40];
  second.rawEvidence = "raw/second.json";
  run.evidence[second.rawEvidence] = { output: "second repetition" };
  run.cases[0].samples.push(second);
  const send = structuredClone(run.cases[0]);
  send.id = "send/example";
  send.group = "send";
  send.samples.forEach((sample) => {
    sample.rawEvidence = "raw/send-" + sample.iteration + ".json";
    run.evidence[sample.rawEvidence] = { output: "send repetition " + sample.iteration };
  });
  run.cases.push(send);
  return run;
}

describe("offline interaction dashboard DOM contract", () => {
  test("filtering preserves drill-down; choosing a case resets and rebinds the sample picker", () => {
    const run = repeatedCases();
    const { get } = openDashboard(run);
    expect(get("rows").children.map((row) => row.children[0].children[0].textContent)).toEqual(
      run.cases.map((c) => c.id),
    );
    get("rows").children[1].children[0].children[0].onclick!();
    expect(get("detail-title").textContent).toBe("send/example");
    expect(get("samples").children).toHaveLength(2);
    get("samples").value = "1";
    get("samples").onchange!();
    expect(JSON.parse(get("sample").textContent).iteration).toBe(1);
    expect(JSON.parse(get("raw").textContent)).toEqual({ output: "send repetition 1" });
    get("group").value = "tools";
    get("group").onchange!();
    expect(get("rows").children).toHaveLength(1);
    expect(get("detail-title").textContent).toBe("send/example");
    get("filter").value = "SHORT";
    get("filter").oninput!();
    expect(get("rows").children).toHaveLength(0);
    expect(JSON.parse(get("sample").textContent).iteration).toBe(1);
    get("filter").value = "short";
    get("filter").oninput!();
    get("rows").children[0].children[0].children[0].onclick!();
    expect(get("detail-title").textContent).toBe(run.cases[0].id);
    expect(JSON.parse(get("sample").textContent).iteration).toBe(0);
    get("samples").value = "1";
    get("samples").onchange!();
    expect(JSON.parse(get("sample").textContent).iteration).toBe(1);
    expect(JSON.parse(get("raw").textContent)).toEqual({ output: "second repetition" });
  });

  test("renders gaps as n/a, zero as measured, and equality as a miss", () => {
    const run = reportFixture();
    run.budgetMs = 7;
    run.cases[0].samples[0].frameMs = [];
    const { get } = openDashboard(run);
    const cells = get("rows").children[0].children;
    expect(cells.map((cell) => cell.textContent).slice(1)).toEqual([
      "7.000 ms / 7.000 ms",
      "1/1",
      "7.000 ms / n/a",
      "1000.000 ms",
      "n/a",
      "missing",
    ]);
    expect(cells[2].className).toBe("miss");
    const sample = run.cases[0].samples[0];
    sample.frameMs = [0];
    sample.firstVisibleAckMs = 0;
    sample.inputLatenessMs = [0];
    run.budgetMs = 8;
    const measured = openDashboard(run).get("rows").children[0].children;
    expect(measured[2].className).toBe("");
    expect(measured[3].textContent).toBe("7.000 ms / 0.000 ms");
    expect(measured[4].textContent).toBe("0.000 ms");
    expect(measured[5].textContent).toBe("0.000 ms");
  });

  test("slow spans are descending and capped, never summed or written back into evidence", () => {
    const run = repeatedCases();
    const before = structuredClone(run);
    const { get, browserData } = openDashboard(run);
    const embeddedData = JSON.parse(get("interaction-data").textContent);
    expect(browserData).toEqual(embeddedData);
    expect(JSON.parse(get("slow").textContent).map((s: { durationMs: number }) => s.durationMs)).toEqual([7, 6]);
    get("samples").value = "1";
    get("samples").onchange!();
    const slow = JSON.parse(get("slow").textContent);
    expect(slow).toHaveLength(20);
    expect(slow[0]).toEqual({ name: "full frame 0", kind: "frame", durationMs: 40 });
    expect(slow.at(-1).durationMs).toBe(11);
    expect(browserData).toEqual(embeddedData);
    expect(run).toEqual(before);
    const short = reportFixture();
    short.cases[0].samples[0].contiguousSyncMs = 0;
    expect(JSON.parse(openDashboard(short).get("slow").textContent).at(-1)).toEqual({
      name: "full contiguous slice",
      durationMs: 0,
    });
  });

  test("baseline presentation is the report comparison, including exclusions and nullable frame deltas", () => {
    const current = repeatedCases();
    const baseline = structuredClone(current);
    baseline.budgetMs = 1;
    baseline.sources.fingerprint = "old";
    baseline.cases[1].scope = "other scope";
    baseline.cases[0].samples.forEach((s) => {
      s.frameMs = [];
    });
    const { get } = openDashboard(current, baseline);
    expect(JSON.parse(get("comparison").textContent)).toEqual(compareInteractions(current, baseline));
    expect(JSON.parse(get("comparison").textContent).cases[0].frameMaxDeltaMs).toBeNull();
    expect(openDashboard(current).get("comparison").textContent).toContain("No baseline supplied.");
  });

  test("hostile evidence remains escaped JSON and inert text at every drill-down", () => {
    const run = reportFixture();
    const hostile = "</script><img src=x onerror=alert(1)>&\u2028\u2029";
    run.cases[0].id = hostile;
    run.cases[0].scope = hostile;
    run.evidence["raw/test.json"] = { output: hostile };
    const { get, html } = openDashboard(run);
    expect(html).not.toContain(hostile);
    expect(html).not.toContain("innerHTML");
    expect(get("rows").children[0].children[0].children[0].textContent).toBe(hostile);
    expect(get("detail-title").textContent).toBe(hostile);
    expect(JSON.parse(get("scope").textContent).scope).toBe(hostile);
    expect(JSON.parse(get("raw").textContent).output).toBe(hostile);
  });
});
