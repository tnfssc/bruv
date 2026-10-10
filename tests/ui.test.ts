import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { agentParser } from "../src/agents";
import { Jobs, registerJobs } from "../src/jobs";
import { registerUI } from "../src/ui";
import { sdk } from "./sdk";

test.each([false, true])("work display follows UI availability (%s)", async (hasUI) => {
  const jobs = new Jobs();
  const widgets: unknown[] = [];
  const statuses: (string | undefined)[] = [];
  let refreshed: (() => void) | undefined;
  const app = await sdk(
    [
      (pi) => {
        registerUI(pi, jobs);
        registerJobs(pi, jobs);
      },
    ],
    hasUI
      ? {
          setWidget: (_key, content) => {
            widgets.push(content);
            refreshed?.();
          },
          setStatus: (_key, content) => {
            statuses.push(content);
          },
        }
      : undefined,
  );
  try {
    const item = jobs.create("agent", "fixture", app.dir);
    const updates = widgets.length;
    const parser = agentParser(jobs, item);
    for (let i = 0; i < 10; i++) {
      const chunk = `${JSON.stringify({ type: "tool_execution_start", toolName: "read" })}\n`;
      jobs.append(item, chunk);
      parser.push(chunk);
    }
    expect(widgets).toHaveLength(updates);
    item.usage = { input: 1, output: 2, cost: 0.25 };
    if (hasUI) {
      await new Promise<void>((resolve) => {
        refreshed = resolve;
      });
      expect(widgets.length).toBeGreaterThan(updates);
      expect(widgets[widgets.length - 1]).toHaveLength(1);
      expect(statuses[statuses.length - 1]).toBeDefined();
      expect(app.session.extensionRunner.getMessageRenderer("bruv-report")).toBeDefined();
      expect(app.session.extensionRunner.getMessageRenderer("bruv-answer")).toBeDefined();
    }
    await jobs.run(item, async () => 0);
    if (hasUI) {
      expect(widgets[widgets.length - 1]).toHaveLength(1);
      app.faux.setResponses([fauxAssistantMessage("ready")]);
      await app.session.prompt("next");
      await new Promise<void>((resolve) => {
        refreshed = resolve;
      });
      expect(widgets[widgets.length - 1]).toBeUndefined();
    } else {
      expect(widgets).toEqual([]);
      expect(statuses).toEqual([]);
    }
  } finally {
    await app.close();
  }
  if (hasUI) expect(statuses[statuses.length - 1]).toBeUndefined();
});
