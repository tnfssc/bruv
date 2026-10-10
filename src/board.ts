import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Jobs, Work } from "./jobs";

const oneLine = (text: string) => text.replace(/[\r\n\t]+/g, " ");
const duration = (seconds: number) => (seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`);
export function visibleWork(items: Work[], now = Date.now()) {
  const finished = items.filter((item) => item.status !== "running");
  const recent = finished.filter((item) => now - (item.endedAt as number) < 30000);
  if (!recent.length && !items.some((item) => item.status === "running")) return [];
  const latest = finished.sort((a, b) => (b.endedAt as number) - (a.endedAt as number)).slice(0, 3);
  return items.filter((item) => item.status === "running" || recent.includes(item) || latest.includes(item));
}

export class WorkBoard {
  private timer?: ReturnType<typeof setInterval>;
  private frame = 0;
  items: Work[] = [];
  constructor(
    private jobs: Jobs,
    private theme: Theme,
    private requestRender: () => void,
    private now = () => Date.now(),
  ) {}
  update(items: Work[]) {
    this.items = items;
    if (items.some((item) => item.status === "running") && !this.timer) {
      this.timer = setInterval(() => {
        this.frame++;
        this.requestRender();
      }, 100);
      this.timer.unref();
    } else if (!items.some((item) => item.status === "running")) this.dispose();
    this.requestRender();
  }
  dispose() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
  invalidate() {}
  render(width: number) {
    const shown = visibleWork(this.items, this.now());
    if (!shown.length) return [];
    const rows = shown.map((item) => {
      const running = item.status === "running";
      const mark = running
        ? "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[this.frame % 10]
        : { running: "", done: "✓", failed: "✗", stopped: "■" }[item.status];
      const color = running
        ? "accent"
        : item.status === "done"
          ? "success"
          : item.status === "failed"
            ? "error"
            : "dim";
      const parts = [this.theme.fg(color, mark), item.id];
      if (running && item.kind === "agent") {
        if (item.progress) parts.push(oneLine(item.progress));
        parts.push(`${item.tokens ?? (item.usage?.input ?? 0) + (item.usage?.output ?? 0)} tokens`);
      }
      if (!running && item.changes) {
        const { added, removed, files } = item.changes;
        parts.push(`+${added} −${removed}`, `${files} files`);
      }
      parts.push(this.theme.fg("dim", duration(this.jobs.summary(item).elapsedSeconds)));
      parts.splice(
        2,
        0,
        truncateToWidth(oneLine(item.title), Math.max(0, width - visibleWidth(parts.join(" · ")) - 3)),
      );
      return truncateToWidth(parts.join(" · "), width);
    });
    const folded = this.items.filter((item) => !shown.includes(item));
    const counts = (["done", "failed", "stopped"] as const).flatMap((status) => {
      const count = folded.filter((item) => item.status === status).length;
      return count ? [`${count} ${status}`] : [];
    });
    if (counts.length) rows.push(truncateToWidth(this.theme.fg("dim", counts.join(" · ")), width));
    return rows;
  }
}
