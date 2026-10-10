import { expect, test } from "bun:test";
import { Jobs, registerJobs } from "../src/jobs";
import { registerUI } from "../src/ui";
import { sdk } from "./sdk";

test.each([false, true])("work display follows UI availability (%s)", async (hasUI) => {
  const jobs = new Jobs();
  const widgets: unknown[] = [];
  const statuses: (string | undefined)[] = [];
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
          },
          setStatus: (_key, content) => {
            statuses.push(content);
          },
        }
      : undefined,
  );
  try {
    const item = jobs.create("agent", "fixture", app.dir);
    item.usage = { input: 1, output: 2, cost: 0.25 };
    jobs.changed();
    if (hasUI) {
      expect(widgets[widgets.length - 1]).toHaveLength(1);
      expect(statuses[statuses.length - 1]).toBeDefined();
      expect(app.session.extensionRunner.getMessageRenderer("bruv-report")).toBeDefined();
      expect(app.session.extensionRunner.getMessageRenderer("bruv-answer")).toBeDefined();
    }
    await jobs.run(item, async () => 0);
    if (hasUI) expect(widgets[widgets.length - 1]).toBeUndefined();
    else {
      expect(widgets).toEqual([]);
      expect(statuses).toEqual([]);
    }
  } finally {
    await app.close();
  }
  if (hasUI) expect(statuses[statuses.length - 1]).toBeUndefined();
});
