import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type Focusable,
  type KeybindingsManager,
  stripTerminalSequences,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { type MonitorTask, monitorActive, type TaskMonitorSource } from "../tasks/task-monitor-source";

const OUTPUT_BYTES = 2400;
const OUTPUT_LINES = 12;
const INSPECT_BYTES = 5000;
const COMMAND_CHARS = 300;
const RENDER_INTERVAL_MS = 100;

function displayId(id: string): string {
  return id.startsWith("ssh:") && id.length > 28 ? `ssh:…${id.slice(-12)}` : id;
}

function age(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
function cleanTerminalText(value: string, preserveNewlines = false): string {
  const stripped = stripTerminalSequences(value);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Remove terminal control bytes while optionally keeping newlines.
  const controls = preserveNewlines ? /[\x00-\x09\x0b-\x1f\x7f-\x9f]/g : /[\x00-\x1f\x7f-\x9f]/g;
  return stripped.replace(controls, "�");
}
function cleanCommand(value: string): string {
  return cleanTerminalText(value).slice(0, COMMAND_CHARS);
}
function terminalRows(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 24;
}
interface TaskView {
  lines: string[];
  identity: string;
}
interface MonitorFrame {
  border: string;
  title: string;
  body: string[];
  controls: string;
  identity?: string;
}
function fitRows(frame: MonitorFrame, height: number): string[] {
  if (height <= 0) return [];
  const { border, title, body, controls, identity = controls } = frame;
  const lines = [border, title, ...body, controls, border];
  if (lines.length <= height) return lines;
  // A usable action must never outlive the line identifying its target. At one
  // row show only that identity; at two and three rows pair it with controls.
  // Stop prompts are both the frozen identity and the controls, so avoid
  // duplicating them.
  if (height === 1) return [identity];
  if (height === 2) return identity === controls ? [title, controls] : [identity, controls];
  if (height === 3) return identity === controls ? [border, title, controls] : [title, identity, controls];
  if (height === 4 && identity !== controls) return [title, identity, controls, border];

  // Keep the frame title and controls. Blank spacer rows are the first thing
  // dropped on a short terminal so selected/inspection information remains useful.
  const usefulBody = [...body.filter((line) => line !== ""), ...body.filter((line) => line === "")];
  return [border, title, ...usefulBody.slice(0, height - 4), controls, border];
}
function cleanOutput(value: string): string[] {
  const lines = cleanTerminalText(value, true).replace(/\r/g, "").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.slice(-OUTPUT_LINES);
}

/** Session job observations and confirmed stop requests; never consumes task completion. */
export class TaskMonitorPanel implements Component, Focusable {
  private selected = 0;
  private selectedId?: string;
  private confirming?: { id: string; identity: string; ownership?: string };
  private inspecting = false;
  private disposed = false;
  private renderTimer?: ReturnType<typeof setTimeout>;
  private clock?: ReturnType<typeof setInterval>;
  private unsubscribe: () => void;
  private hasFocus = false;
  get focused() {
    return this.hasFocus;
  }
  set focused(value: boolean) {
    this.hasFocus = value;
  }

  constructor(
    private manager: TaskMonitorSource,
    private theme: Theme,
    private keys: KeybindingsManager,
    private done: () => void,
    private changed: () => void,
    private maxRows: () => number = () => process.stdout.rows || 24,
    private releaseSource: () => void = () => {},
  ) {
    this.unsubscribe = manager.subscribe(() => this.scheduleRender());
    this.clock = setInterval(() => this.scheduleRender(), 1000);
    this.clock.unref?.();
  }
  private running(): MonitorTask[] {
    return this.manager.list().filter((task) => monitorActive(task));
  }
  private scheduleRender() {
    if (this.disposed || this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined;
      if (!this.disposed) this.changed();
    }, RENDER_INTERVAL_MS);
    this.renderTimer.unref?.();
  }
  private syncSelection(tasks: MonitorTask[]): void {
    const preserved = this.selectedId && tasks.findIndex((task) => task.id === this.selectedId);
    if (typeof preserved === "number" && preserved >= 0) this.selected = preserved;
    else this.selected = Math.max(0, Math.min(this.selected, tasks.length - 1));
    this.selectedId = tasks[this.selected]?.id;
  }
  private stopPrompt(): string | undefined {
    if (!this.confirming) return undefined;
    return this.theme.fg(
      "error",
      `Stop ${displayId(this.confirming.id)} (${this.confirming.identity})? Enter/y confirm · Esc/n cancel`,
    );
  }
  private move(delta: number) {
    const tasks = this.running();
    this.syncSelection(tasks);
    if (!tasks.length) {
      this.selected = 0;
      this.selectedId = undefined;
      return;
    }
    this.selected = (this.selected + delta + tasks.length) % tasks.length;
    this.selectedId = tasks[this.selected].id;
    this.confirming = undefined;
  }
  handleInput(data: string) {
    const cancel = data === "\x1b" || this.keys.matches(data, "tui.select.cancel");
    const confirm = data === "\r" || this.keys.matches(data, "tui.select.confirm");
    if (this.confirming) {
      if (cancel || data.toLowerCase() === "n") {
        this.confirming = undefined;
        this.changed();
        return;
      }
      if (terminalRows(this.maxRows()) === 0) return;
      if (confirm || data.toLowerCase() === "y") {
        const target = this.confirming;
        const task = this.manager.list().find((task) => task.id === target.id && monitorActive(task));
        if (task && task.monitorIdentity === target.ownership) this.manager.kill(target.id);
        this.confirming = undefined;
        this.changed();
        return;
      }
      return;
    }
    if (cancel) {
      if (this.inspecting) {
        this.inspecting = false;
        this.changed();
      } else this.done();
      return;
    }
    // With no display rows there is no way to verify a target. Keep Escape
    // available, but suppress navigation, inspection, and stop actions.
    if (terminalRows(this.maxRows()) === 0) return;
    if (confirm || data.toLowerCase() === "i") {
      if (this.running().length) {
        this.inspecting = !this.inspecting;
        this.changed();
      }
      return;
    }
    if (data === "\x1b[A" || data === "k" || this.keys.matches(data, "tui.select.up")) {
      this.move(-1);
      this.changed();
      return;
    }
    if (data === "\x1b[B" || data === "j" || this.keys.matches(data, "tui.select.down")) {
      this.move(1);
      this.changed();
      return;
    }
    if (data.toLowerCase() === "s" || data.toLowerCase() === "x") {
      const tasks = this.running();
      this.syncSelection(tasks);
      const task = tasks[this.selected];
      if (task) {
        this.confirming = { id: task.id, identity: cleanCommand(task.command), ownership: task.monitorIdentity };
        this.changed();
      }
    }
  }
  render(width: number): string[] {
    if (width < 1) return [];
    const height = terminalRows(this.maxRows());
    const tasks = this.running();
    this.syncSelection(tasks);
    const prompt = this.stopPrompt();
    const frame: MonitorFrame = {
      border: this.theme.fg("accent", "─".repeat(width)),
      title: this.theme.bold(
        tasks.some((task) => task.status === "unknown") ? "Running jobs · unknown SSH observations" : "Running jobs",
      ),
      body: [],
      controls: prompt ?? this.theme.fg("dim", "Esc close"),
      identity: prompt,
    };
    const task = tasks[this.selected];
    if (!task) {
      frame.body = [
        "",
        this.theme.fg(
          "muted",
          this.manager.list().length ? "No jobs are running." : "No jobs have been started in this session.",
        ),
        this.manager.notice ? this.theme.fg("warning", cleanCommand(this.manager.notice)) : "",
      ];
    } else {
      if (this.manager.notice) frame.body.push(this.theme.fg("warning", cleanCommand(this.manager.notice)));
      const view = this.inspecting ? this.renderInspection(task, height) : this.renderOverview(tasks, task, height);
      frame.body.push("", ...view.lines, "");
      frame.identity = prompt ?? view.identity;
      frame.controls =
        prompt ??
        this.theme.fg(
          "dim",
          this.inspecting
            ? "↑↓/j/k select · Enter/i back · s/x stop · Esc back"
            : "↑↓/j/k select · Enter/i inspect · s/x stop · Esc close",
        );
    }
    return fitRows(frame, height).map((line) => truncateToWidth(line, width));
  }
  private renderInspection(task: MonitorTask, height: number): TaskView {
    const lines: string[] = [];
    const metadataRows = 9 + (task.agent?.lastActivityAt ? 1 : 0);
    const outputRows = Math.max(1, Math.min(OUTPUT_LINES, height - metadataRows));

    const identity = this.theme.bold(this.theme.fg("accent", `Inspect ${displayId(task.id)}`));
    lines.push(
      identity,
      this.theme.fg(
        "dim",
        cleanCommand(
          [
            task.agent ? `agent ${task.agent.type}` : task.kind,
            task.ssh
              ? `owner ${task.ssh.ownerId} · epoch ${task.ssh.epoch}`
              : task.pid
                ? `pid ${task.pid}`
                : "pid unavailable",
            task.cwd,
          ].join(" · "),
        ),
      ),
      this.theme.fg(
        "muted",
        task.ssh
          ? `SSH cached output · first ${INSPECT_BYTES} bytes / ${outputRows} visible lines`
          : `Bounded output · last ${INSPECT_BYTES} bytes / ${outputRows} visible lines`,
      ),
    );
    lines.push(...this.renderObservation(task, INSPECT_BYTES, outputRows));
    return { lines, identity };
  }
  private renderOverview(tasks: MonitorTask[], task: MonitorTask, height: number): TaskView {
    const lines: string[] = [];
    const hasActivity = !!task.agent?.lastActivityAt;
    const fixedRows = 8 + (hasActivity ? 1 : 0);
    const available = Math.max(2, height - fixedRows);
    const previewRows = Math.min(OUTPUT_LINES, Math.max(1, Math.floor(available / 2)));
    const taskRows = Math.max(1, available - previewRows);
    const pageStart = Math.max(0, Math.min(this.selected - Math.floor(taskRows / 2), tasks.length - taskRows));
    const pageEnd = Math.min(tasks.length, pageStart + taskRows);
    let identity = "";
    for (let i = pageStart; i < pageEnd; i++) {
      const listed = tasks[i],
        selected = i === this.selected;
      if (!listed) continue;
      const role = listed.ssh ? `ssh ${listed.status} stale` : listed.agent ? listed.agent.type : listed.kind;
      const label =
        (selected ? "› " : "  ") +
        this.theme.fg(selected ? "accent" : "muted", displayId(listed.id)) +
        " " +
        this.theme.fg(
          listed.agent?.type === "orchestrator" ? "warning" : listed.agent ? "accent" : "dim",
          `[${role}]`,
        ) +
        " " +
        cleanCommand(listed.command) +
        "  " +
        this.theme.fg("dim", listed.ssh ? "cached observation" : age(Date.now() - Date.parse(listed.startedAt)));
      const line = selected ? this.theme.bold(label) : label;
      if (selected) identity = line;
      lines.push(line);
    }
    lines.push(
      "",
      this.theme.fg(
        "muted",
        task.ssh
          ? `SSH cached output · first ${OUTPUT_BYTES} bytes / ${OUTPUT_LINES} lines`
          : `Live preview · last ${OUTPUT_BYTES} bytes / ${OUTPUT_LINES} lines`,
      ),
    );
    lines.push(...this.renderObservation(task, OUTPUT_BYTES, previewRows));
    return { lines, identity };
  }
  private renderObservation(task: MonitorTask, bytes: number, rows: number): string[] {
    const lines: string[] = [];
    const inspection = this.manager.inspect(task.id, Math.max(task.baseOffset, task.outputEnd - bytes), bytes);
    const outputLines = cleanOutput(inspection.output).slice(-rows);
    if (task.outputEnd === 0) lines.push(this.theme.fg("dim", "No output available yet."));
    else if (!outputLines.some((line) => line.trim()))
      lines.push(this.theme.fg("dim", "Output received, but it is whitespace only."));
    else lines.push(...outputLines.map((line) => `  ${line}`));
    if (task.agent?.lastActivityAt) {
      const quiet = Date.now() - Date.parse(task.agent.lastActivityAt);
      lines.push(
        this.theme.fg(
          "dim",
          "Agent quiet for " +
            age(quiet) +
            " · " +
            (task.agent.phase ?? "running") +
            (task.agent.events !== undefined ? ` · ${task.agent.events} events` : ""),
        ),
      );
    }
    if (task.ssh) {
      lines.push(
        this.theme.fg(
          "warning",
          cleanCommand(
            "SSH " +
              task.status +
              " · stale observation " +
              (task.ssh.observedAt ?? "unavailable") +
              (task.ssh.remoteState ? ` · remote ${task.ssh.remoteState}` : "") +
              (task.ssh.cancelRequested ? ` · cancellation ${task.ssh.cancelDelivery ?? "pending"}` : ""),
          ),
        ),
      );
      const note = task.monitorNote ?? task.ssh.lastError;
      if (note) lines.push(this.theme.fg("warning", cleanCommand(note)));
    }
    return lines;
  }
  invalidate() {}
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.releaseSource();
    if (this.renderTimer) clearTimeout(this.renderTimer);
    if (this.clock) clearInterval(this.clock);
  }
}
