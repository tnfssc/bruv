import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TaskManager } from "./task-manager";
import type { RemoteJobsAdapter } from "../remote/jobs";
import { MergedTaskMonitorSource } from "./task-monitor-source";
import { TaskMonitorPanel } from "../ui/task-monitor";

/** Register /ps over the existing local manager and optional session-owned SSH cache. */
export function registerTaskMonitor(
  pi: ExtensionAPI,
  getManager: () => TaskManager,
  remoteJobs?: RemoteJobsAdapter,
): void {
  pi.registerCommand("ps", {
    description: "Monitor and stop active session jobs",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/ps is available in interactive mode", "warning");
        return;
      }
      await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
        const source = remoteJobs
          ? new MergedTaskMonitorSource(getManager(), remoteJobs, ctx.sessionManager?.getSessionFile?.())
          : getManager();
        let panel: TaskMonitorPanel;
        panel = new TaskMonitorPanel(
          source,
          theme,
          keybindings,
          () => done(),
          () => tui.requestRender(),
          () => tui.terminal.rows,
          () => {
            if (source instanceof MergedTaskMonitorSource) source.dispose();
          },
        );
        return panel;
      });
    },
  });
}
