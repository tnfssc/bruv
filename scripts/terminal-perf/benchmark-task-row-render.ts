// Run with bun scripts/terminal-perf/benchmark-task-row-render.ts. No provider or terminal needed.
// Compare this same fixture across revisions; times are evidence, not test thresholds.
import { ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { installSdkTaskRows } from "../../src/ui/sdk-task-rows";
import { taskRowFromLaunch, type TaskRow } from "../../src/ui/task-rows";

initTheme("dark", false);
const theme = { fg: (_color: string, text: string) => text } as any;
for (const mode of ["no-tasks", "persisted-tasks", "live-tasks-expanded"] as const) {
  for (const count of [100, 500, 1000]) {
    const live: TaskRow[] = [];
    let snapshots = 0;
    const restore = installSdkTaskRows(theme, () => {
      snapshots++;
      return live;
    });
    try {
      const chat = new Container();
      for (let index = 0; index < count; index++) {
        const call = "call-" + index;
        const task = taskRowFromLaunch(
          { id: "task-" + index, kind: "command", status: "completed", title: "Check " + index },
          call,
        )!;
        if (mode === "live-tasks-expanded") live.push(task);
        const tool = new ToolExecutionComponent(
          "execute",
          call,
          { code: "1", label: "Check " + index },
          {},
          {
            name: "execute",
            renderShell: "self",
            renderCall: () => new Text("✓ Check", 0, 0),
            renderResult: () => new Text("Done", 0, 0),
          } as any,
          { requestRender() {} } as any,
          process.cwd(),
        );
        tool.updateResult({
          content: [{ type: "text", text: "Done" }],
          details: { taskRows: mode === "persisted-tasks" ? [task] : [] },
          isError: false,
        });
        if (mode === "live-tasks-expanded") tool.setExpanded(true);
        chat.addChild(tool);
      }
      for (let index = 0; index < 3; index++) chat.render(100);
      snapshots = 0;
      const times = [];
      for (let index = 0; index < 7; index++) {
        const start = performance.now();
        chat.render(100);
        times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      console.log(
        JSON.stringify({ mode, count, medianMs: +times[3].toFixed(3), snapshotsPerFrame: snapshots / times.length }),
      );
    } finally {
      restore();
    }
  }
}
