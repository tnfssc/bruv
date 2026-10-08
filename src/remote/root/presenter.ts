import { actionError, actionLabel } from "../../ui/action-label";
import {
  formatTaskRow,
  taskRowFromLaunch,
  taskRowKey,
  taskRowWithExecuteLabel,
  taskRowsFromDetails,
  taskSummaryRowsFromDetails,
  upsertTaskRow,
  type TaskRow,
} from "../../ui/task-rows";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Editor,
  type EditorTheme,
  getKeybindings,
  Markdown,
  type MarkdownTheme,
  ProcessTerminal,
  stripTerminalSequences,
  truncateToWidth,
  Text,
  TuiMainScreen,
} from "@earendil-works/pi-tui";
import { QuestionPicker } from "../../questions/picker";
import type { RootClient } from "./client";
import type { RootCommand, RootDialog, RootObservation, RootRecord } from "./contract";

const plain = (s: string) => s;
const accent = (s: string) => "\x1b[36m" + s + "\x1b[0m";
const safe = (s: unknown) =>
  stripTerminalSequences(String(s ?? ""))
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "�")
    .slice(0, 24000);
const theme = {
  fg: (_name: string, s: string) => s,
  bg: (_name: string, s: string) => s,
  bold: plain,
} as unknown as Theme;
const markdownTheme: MarkdownTheme = {
  heading: accent,
  link: plain,
  linkUrl: plain,
  code: plain,
  codeBlock: plain,
  codeBlockBorder: plain,
  quote: plain,
  quoteBorder: plain,
  hr: plain,
  listBullet: plain,
  bold: plain,
  italic: plain,
  strikethrough: plain,
  underline: plain,
};
const editorTheme: EditorTheme = {
  borderColor: accent,
  selectList: { selectedPrefix: accent, selectedText: accent, description: plain, scrollInfo: plain, noMatch: plain },
};
export type Question = {
  id: string;
  text: string;
  owner: { sessionId: string; branchId: string };
  version: number;
  status: string;
  choices?: string[];
  allowFreeText?: boolean;
};
export interface RootPresentationControls {
  choose(
    title: string,
    items: Array<{ value: string; label: string; description?: string }>,
  ): Promise<string | undefined>;
  answer(question: Question): Promise<string | undefined>;
  notice(text: string): void;
  detach(): void;
}
function list(value: any, key: string): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.[key])) return value[key];
  throw Error("Invalid remote " + key + " facet");
}
/** Human actions use exactly the root command ledger, never an agent/tool execution seam. */
export class RootControls {
  constructor(
    private client: Pick<RootClient, "command" | "result" | "read">,
    private ui: RootPresentationControls,
  ) {}
  private async dispatch(command: RootCommand) {
    const state = this.client.read();
    for (const [id, saved] of Object.entries(state.commands)) {
      if (saved.receipt.state === "completed") continue;
      if (
        command.kind === "questions.answer" &&
        saved.command.kind === "questions.answer" &&
        saved.command.id === command.id &&
        saved.command.version === command.version
      ) {
        const { replyId: _new, ...next } = command;
        const { replyId: _old, ...prior } = saved.command;
        if (!isDeepStrictEqual(next, prior))
          throw Error("Question answer outcome is uncertain; cannot replace saved intent");
        return this.client.command(saved.command, id);
      }
      if (command.kind === "ui.respond" && saved.command.kind === "ui.respond" && saved.command.id === command.id) {
        if (!isDeepStrictEqual(saved.command, command))
          throw Error("Dialog response outcome uncertain; cannot replace saved intent");
        return this.client.command(saved.command, id);
      }
      if (isDeepStrictEqual(saved.command, command)) return this.client.command(saved.command, id);
    }
    return this.client.command(command);
  }
  private async send(command: RootCommand) {
    const receipt = await this.dispatch(command);
    if (receipt.error) throw Error(receipt.error);
    return receipt;
  }
  async dialog(dialog: RootDialog, attached: () => boolean = () => true): Promise<void> {
    let response: RootCommand;
    if (dialog.method === "confirm") {
      const selected = await this.ui.choose(safe(dialog.title) + " " + safe(dialog.message), [
        { value: "no", label: "No" },
        { value: "yes", label: "Yes" },
      ]);
      response =
        selected === undefined
          ? { kind: "ui.respond", id: dialog.id, cancelled: true }
          : { kind: "ui.respond", id: dialog.id, confirmed: selected === "yes" };
    } else if (dialog.method === "select") {
      const selected = await this.ui.choose(
        safe(dialog.title),
        (dialog.options ?? []).map((label, i) => ({ value: String(i), label: safe(label) })),
      );
      response =
        selected === undefined
          ? { kind: "ui.respond", id: dialog.id, cancelled: true }
          : { kind: "ui.respond", id: dialog.id, value: dialog.options![Number(selected)]! };
    } else {
      const value = await this.ui.answer({
        id: dialog.id,
        text: safe(dialog.title ?? dialog.message),
        owner: { sessionId: "", branchId: "" },
        version: 0,
        status: "pending",
      });
      response =
        value === undefined
          ? { kind: "ui.respond", id: dialog.id, cancelled: true }
          : { kind: "ui.respond", id: dialog.id, value };
    }
    if (!attached()) return; // Disconnect detaches; it does not answer/cancel a server dialog.
    const receipt = await this.send(response);
    this.ui.notice("Dialog response request " + receipt.state + " (application acknowledgement unavailable)");
  }
  async submit(text: string): Promise<void> {
    text = text.trim();
    if (!text) return;
    if (text === "/detach" || text === "/exit" || text === "/quit") {
      this.ui.detach();
      return;
    }
    if (text === "/abort") {
      const r = await this.send({ kind: "abort" });
      this.ui.notice(
        "Abort request " +
          r.state +
          " (presentation remains attached)" +
          (r.result === undefined ? "" : " · " + safe(JSON.stringify(r.result))),
      );
      return;
    }
    if (text === "/close") {
      const r = await this.send({ kind: "close" });
      this.ui.notice("Root close " + r.state + "; waiting for authoritative closed state before source return");
      return;
    }
    if (text === "/questions") {
      const questions = list(await this.client.result({ kind: "questions.list" }), "questions").filter(
        (q) => q.status === "pending",
      ) as Question[];
      if (!questions.length) {
        this.ui.notice("No pending human questions");
        return;
      }
      const id = await this.ui.choose(
        "Human questions",
        questions.map((q) => ({ value: q.id, label: safe(q.text) })),
      );
      const q = questions.find((q) => q.id === id);
      if (!q) return;
      const answer = await this.ui.answer(q);
      if (answer === undefined) return;
      const current = list(await this.client.result({ kind: "questions.list" }), "questions").find(
        (x) => x.id === q.id,
      );
      if (current?.status !== "pending" || current.version !== q.version || !isDeepStrictEqual(current.owner, q.owner))
        throw Error("Question changed; reopen /questions before answering");
      const r = await this.send({
        kind: "questions.answer",
        id: q.id,
        owner: q.owner,
        version: q.version,
        text: answer,
        replyId: randomUUID(),
      });
      this.ui.notice("Answer " + r.state);
      return;
    }
    if (text === "/ps") {
      const jobs = list(await this.client.result({ kind: "jobs.list", count: 100 }), "jobs");
      if (!jobs.length) {
        this.ui.notice("No jobs");
        return;
      }
      const id = await this.ui.choose(
        "Jobs on " + safe(this.client.read().target.name),
        jobs.map((j) => ({
          value: j.id,
          label: safe(j.title ?? j.command ?? j.id),
          description: safe(j.status ?? j.state),
        })),
      );
      const job = jobs.find((j) => j.id === id);
      if (!job) return;
      const detail: any = await this.client.result({ kind: "jobs.inspect", id: job.id, limit: 5000 });
      const action = await this.ui.choose(safe(detail.output ?? JSON.stringify(detail)), [
        { value: "back", label: "Back" },
        { value: "stop", label: "Cancel " + safe(job.title ?? job.command ?? job.id) },
      ]);
      if (action !== "stop") return;
      const confirm = await this.ui.choose("Cancel this job? " + safe(job.title ?? job.command ?? job.id), [
        { value: "no", label: "Keep running" },
        { value: "yes", label: "Cancel job" },
      ]);
      if (confirm === "yes") {
        const r = await this.send({ kind: "jobs.stop", id: job.id });
        this.ui.notice(
          "Job cancellation request " +
            r.state +
            (r.result === undefined ? "" : " · " + safe(JSON.stringify(r.result))),
        );
      }
      return;
    }
    if (text.startsWith("/")) throw Error("Remote root controls: /questions /ps /abort /close /detach");
    const unresolved = Object.values(this.client.read().commands).find(
      (c) => c.command.kind === "prompt" && c.receipt.state !== "completed",
    );
    if (unresolved)
      throw Error(
        "Previous prompt delivery is " +
          unresolved.receipt.state +
          "; reconnect is reconciling its saved identity. No duplicate prompt sent.",
      );
    const receipt = await this.send({ kind: "prompt", text });
    if (receipt.state === "unknown")
      this.ui.notice("Prompt delivery unknown; identity saved, never automatically replayed");
  }
}
function messageText(message: any, details = false): string {
  if (typeof message?.content === "string") return safe(message.content);
  return (message?.content ?? [])
    .map((c: any) => {
      if (c.type === "text") return safe(c.text);
      if (c.type === "thinking") return details ? safe(c.thinking ?? c.text ?? "") : "";
      if (c.type === "toolCall" && details) return "Tool: " + safe(c.name) + " " + safe(JSON.stringify(c.arguments));
      return "";
    })
    .filter(Boolean)
    .join("\n");
}
function expandedRootTranscript(messages: any[], width: number): string[] {
  const lines: string[] = [];
  const labels = new Map<string, string>();
  for (const m of messages) {
    if (!m || m.display === false || !Array.isArray(m.content)) continue;
    for (const c of m.content) if (c.type === "toolCall" && c.id) labels.set(c.id, safe(c.arguments?.label ?? c.name));
  }
  for (const m of messages) {
    if (!m || m.display === false) continue;
    const role =
      m.role === "user" ? "You" : m.role === "assistant" ? "Assistant" : m.role === "toolResult" ? "Action" : "Notice";
    lines.push(...new Text(accent(role), 0, 0).render(width));
    let text: string;
    if (m.role === "toolResult") {
      const name = labels.get(m.toolCallId) ?? safe(m.toolName ?? "tool");
      const output = typeof m.content === "string" ? safe(m.content) : messageText(m, true);
      text = (m.isError ? name + " failed" : name + " completed") + (output ? "\n" + output : "");
      if (m.toolCallId) text = "Tool call " + safe(m.toolCallId) + "\n" + text;
    } else text = messageText(m, true);
    lines.push(
      ...(m.role === "assistant" ? new Markdown(text, 0, 0, markdownTheme) : new Text(text, 0, 0)).render(width),
      "",
    );
  }
  return lines;
}

const actionFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Bounded conversation projection, independent of provider settings. Server snapshot wins. */
export class RootTranscript {
  messages: any[] = [];
  streaming?: any;
  progress = "";
  record?: RootRecord;
  private taskSnapshots = new Map<string, TaskRow>();
  details = false;
  apply(observation: RootObservation) {
    this.record = observation.record;
    for (const { event } of observation.events) this.event(event);
  }
  event(event: any) {
    if (!event || typeof event !== "object") return;
    // These are the actual server-owned jobs.list snapshots, not model task prose.
    const facets = event.type === "root_ready" ? event.facets : event.type === "root_facets" ? event : undefined;
    for (const row of taskRowsFromDetails(facets)) upsertTaskRow(this.taskSnapshots, row);
    if (Array.isArray(facets?.jobs))
      for (const job of facets.jobs) {
        // Inline shell/helper work is represented by its foreground action.
        // Older/native/SSH summaries without this local flag remain observable.
        if (job.background === false) continue;
        const row = taskRowFromLaunch(job);
        if (row) upsertTaskRow(this.taskSnapshots, row);
      }
    if (event.type === "message_start" || event.type === "message_update") this.streaming = event.message;
    if (event.type === "message_end") {
      this.messages.push(event.message);
      this.messages = this.messages.slice(-200);
      this.streaming = undefined;
    }
    // Routine lifecycle events are not conversation content. /ps retains task state.
    if (event.type.startsWith("tool_execution_") || event.type === "agent_start" || event.type === "agent_end")
      this.progress = "";
    if (event.type === "question" && event.display !== false) this.progress = safe(event.title ?? event.text ?? "");
  }
  toggleDetails() {
    this.details = !this.details;
  }
  get pendingAction(): boolean {
    const visible = [...this.messages, ...(this.streaming ? [this.streaming] : [])].filter((m) => m?.display !== false);
    const settled = new Set(visible.filter((m) => m?.role === "toolResult").map((m) => m.toolCallId));
    return visible.some(
      (m) =>
        m?.role === "assistant" &&
        Array.isArray(m.content) &&
        m.content.some((c: any) => c.type === "toolCall" && (!c.id || !settled.has(c.id))),
    );
  }
  render(width: number, now = Date.now()): string[] {
    const lines: string[] = [];
    const messages = [...this.messages, ...(this.streaming ? [this.streaming] : [])];
    if (this.details) return expandedRootTranscript(messages, width);
    const taskRows = new Map<string, TaskRow>();
    for (const m of messages) {
      if (!m || m.display === false) continue;
      for (const row of taskRowsFromDetails(m.details)) {
        upsertTaskRow(taskRows, {
          ...row,
          sourceCallId: row.sourceCallId ?? (m.role === "toolResult" ? m.toolCallId : undefined),
        });
      }
    }
    for (const row of this.taskSnapshots.values()) upsertTaskRow(taskRows, row);
    const shownTasks = new Set<string>();
    const task = (row: TaskRow, warning = "") => {
      const key = taskRowKey(row);
      if (shownTasks.has(key)) return;
      shownTasks.add(key);
      lines.push(truncateToWidth(formatTaskRow(row) + warning, width), "");
    };
    const calls = new Map<string, any>();
    const results = new Map<string, any>();
    for (const m of messages) {
      if (!m || m.display === false) continue;
      if (m.role === "toolResult" && m.toolCallId) results.set(m.toolCallId, m);
      if (m.role === "assistant" && Array.isArray(m.content))
        for (const c of m.content) if (c.type === "toolCall" && c.id) calls.set(c.id, c);
    }
    for (const [key, row] of taskRows) {
      const call = calls.get(row.sourceCallId ?? "");
      if (call?.name === "execute") taskRows.set(key, taskRowWithExecuteLabel(row, call.arguments?.label));
    }
    const append = (role: string, text: string, markdown = false) => {
      if (!text) return;
      lines.push(...new Text(accent(role), 0, 0).render(width));
      lines.push(...(markdown ? new Markdown(text, 0, 0, markdownTheme) : new Text(text, 0, 0)).render(width), "");
    };
    const action = (call: any, result?: any) => {
      const outcome = result?.details;
      const failure = outcome?.cancelled
        ? "Cancelled"
        : outcome?.timedOut
          ? "Timed out"
          : result?.isError || outcome?.imageError || (typeof outcome?.exitCode === "number" && outcome.exitCode !== 0)
            ? "Failed"
            : "";
      const id = call?.id ?? result?.toolCallId;
      const launched = [...taskRows.values()].filter((row) => id && row.sourceCallId === id);
      if (launched.length) {
        for (const [index, row] of launched.entries())
          task(row, !failure && index === 0 && outcome?.outputArtifactErrors ? " — ⚠ couldn’t save full output" : "");
        if (!failure) {
          if (typeof outcome?.handoff === "string") append("Assistant", safe(outcome.handoff), true);
          return;
        }
        // A launched task is not evidence that the surrounding action succeeded.
      }
      const args = call?.arguments;
      // Provider arguments are already incrementally parsed, including incomplete labels.
      // Never use source as a label: providers can stream code before the label.
      const caption = actionLabel(
        args?.label,
        undefined,
        result ? safe(call?.name ?? result?.toolName) || "Action" : "",
      );
      const title = !result && !args?.label ? "" : caption;
      const reason = failure
        ? actionError(outcome, messageText(result))
        : outcome?.outputArtifactErrors
          ? "⚠ couldn’t save full output"
          : "";
      const icon = result ? (failure ? "✗" : "✓") : actionFrames[Math.floor(now / 80) % actionFrames.length];
      lines.push(truncateToWidth(icon + (title ? " " + title : "") + (reason ? " — " + reason : ""), width), "");
    };
    const shownCalls = new Set<string>();
    for (const m of messages) {
      if (!m || m.display === false) continue;
      if (m.customType === "task-complete" || m.customType === "task-attention") {
        const rows = taskRowsFromDetails(m.details);
        for (const row of rows) task(taskRows.get(taskRowKey(row)) ?? row);
        const summaries = taskSummaryRowsFromDetails(m.details);
        for (const summary of summaries) lines.push(truncateToWidth(summary.text, width), "");
        if (!rows.length && !summaries.length && m.customType === "task-complete")
          lines.push(truncateToWidth("? Task update — status unknown", width), "");
        continue;
      }
      if (m.role === "toolResult") {
        // Pair by protocol identity, never by matching labels or source text.
        if (!m.toolCallId || !calls.has(m.toolCallId)) action(undefined, m);
        continue;
      }
      if (m.role === "assistant" && Array.isArray(m.content)) {
        let content: any[] = [];
        const flush = () => {
          append("Assistant", messageText({ content }), true);
          content = [];
        };
        for (const c of m.content) {
          if (c.type !== "toolCall") {
            content.push(c);
            continue;
          }
          flush();
          if (c.id && shownCalls.has(c.id)) continue;
          if (c.id) shownCalls.add(c.id);
          action(c, c.id ? results.get(c.id) : undefined);
        }
        flush();
      } else
        append(
          m.role === "user" ? "You" : m.role === "assistant" ? "Assistant" : "Notice",
          messageText(m),
          m.role === "assistant",
        );
    }
    for (const row of taskRows.values()) task(row);
    return lines;
  }
}
export type RootPresenterOptions = { prompt?: string; pollMs?: number };
/** Bruv-owned Pi component frontend. Disconnect is detach, never root abort. */
export async function presentRemoteRoot(client: RootClient, options: RootPresenterOptions = {}): Promise<void> {
  const tui = new TuiMainScreen(new ProcessTerminal());
  const transcript = new RootTranscript();
  const status = new Text();
  const editor = new Editor(tui, editorTheme);
  let closed = false;
  let modal: { component: Component; cancel(): void } | undefined;
  let finish!: () => void;
  const ended = new Promise<void>((resolve) => (finish = resolve));
  const notice = (text: string) => {
    status.setText(safe(text));
    tui.requestRender();
  };
  const detach = () => {
    closed = true;
    modal?.cancel();
    finish();
  };
  const showModal = (create: (done: (value?: string) => void) => Component): Promise<string | undefined> =>
    new Promise((resolve) => {
      const done = (value?: string) => {
        modal = undefined;
        tui.setFocus(editor);
        tui.requestRender();
        resolve(value);
      };
      modal = { component: create(done), cancel: () => done() };
      tui.setFocus(modal.component);
      tui.requestRender();
    });
  const pick = (title: string, items: Array<{ value: string; label: string; description?: string }>) =>
    showModal(
      (done) =>
        new QuestionPicker(
          safe(title),
          items,
          theme,
          getKeybindings(),
          done,
          () => tui.requestRender(),
          () => process.stdout.rows || 24,
        ),
    );
  const answer = async (q: Question): Promise<string | undefined> => {
    if (q.choices?.length) {
      const items = q.choices.map((label, i) => ({ value: String(i), label: safe(label) }));
      if (q.allowFreeText !== false) items.push({ value: "free", label: "Type an answer" });
      const selected = await pick(q.text, items);
      if (selected === undefined) return;
      if (selected !== "free") return q.choices[Number(selected)];
    }
    if (q.allowFreeText === false) return;
    return showModal((done) => {
      const input = new Editor(tui, editorTheme);
      input.onSubmit = (text) => done(text.trim() ? text : undefined);
      return {
        render: (width) => [...new Text(safe(q.text)).render(width), ...input.render(width)],
        handleInput: (data) => input.handleInput(data),
        invalidate: () => input.invalidate(),
      };
    });
  };
  const controls = new RootControls(client, { choose: pick, answer, notice, detach });
  let submitting = false;
  editor.onSubmit = (text) => {
    if (submitting) return;
    submitting = true;
    void controls
      .submit(text)
      .then(() => {
        editor.addToHistory(text);
        editor.setText("");
      })
      .catch((e) => notice(String(e)))
      .finally(() => {
        submitting = false;
        tui.requestRender();
      });
  };
  const root: Component = {
    render(width) {
      if (modal) return modal.component.render(width);
      return [
        ...new Text(
          accent("Bruv · " + client.read().target.name + " · root " + (transcript.record?.state ?? "connecting")),
        ).render(width),
        ...transcript.render(width),
        ...new Text(safe(transcript.progress)).render(width),
        ...status.render(width),
        ...new Text(
          "/questions · /ps · /close · Ctrl-O " +
            (transcript.details ? "hide details" : "tool details") +
            " · Ctrl-C abort · Ctrl-D detach",
        ).render(width),
        ...editor.render(width),
      ];
    },
    handleInput: (data) => {
      if (modal) modal.component.handleInput?.(data);
      else editor.handleInput(data);
    },
    invalidate() {
      editor.invalidate();
      modal?.component.invalidate();
    },
  };
  tui.addChild(root);
  tui.setFocus(editor);
  tui.addInputListener((data) => {
    if (data === "\x0f" && !modal) {
      transcript.toggleDetails();
      tui.requestRender();
      return { consume: true };
    }
    if (data === "\x04") {
      detach();
      return { consume: true };
    }
    if (data === "\x03") {
      if (modal) {
        modal.cancel();
        return { consume: true };
      }
      void controls.submit("/abort").catch((error) => notice(String(error)));
      return { consume: true };
    }
    if (data === "\x1b" && modal) {
      modal.cancel();
      return { consume: true };
    }
    return;
  });
  const signal = () => detach();
  process.on("SIGTERM", signal);
  process.on("SIGHUP", signal);
  tui.start();
  const animation = setInterval(() => {
    if (!closed && transcript.pendingAction && !transcript.details) tui.requestRender();
  }, 80);
  let poll: Promise<void> | undefined;
  try {
    for (const e of client.read().events) transcript.event(e.event);
    if (client.read().record) {
      transcript.record = client.read().record;
    }
    notice(
      client.read().sourceLabel +
        (client.read().cacheStart > 1
          ? " · cached transcript starts at event " + client.read().cacheStart + "; older text remains on server"
          : ""),
    );
    if (options.prompt) {
      try {
        const receipt = await client.initialPrompt(options.prompt);
        notice(receipt.error ? "Startup prompt rejected: " + safe(receipt.error) : "Startup prompt " + receipt.state);
      } catch (error) {
        notice(String(error));
      }
    }
    const reportedErrors = new Set<string>();
    const shownDialogs = new Set<string>();
    poll = (async () => {
      while (!closed) {
        try {
          const receipts = await client.reconcile();
          for (const receipt of receipts) {
            if (receipt.error && !reportedErrors.has(receipt.commandId)) {
              reportedErrors.add(receipt.commandId);
              notice("Remote action rejected: " + safe(receipt.error));
            }
          }
          let observation: RootObservation;
          let pages = 0;
          do {
            observation = await client.observe();
            transcript.apply(observation);
            tui.requestRender();
          } while (observation.hasMore && !closed && ++pages < 20);
          const dialog = observation.record.dialogs?.find((d) => !shownDialogs.has(d.id));
          if (dialog && observation.record.state === "running" && !modal && !submitting) {
            shownDialogs.add(dialog.id);
            await controls.dialog(dialog, () => !closed);
          }
          if (observation.record.state === "closed") {
            const result = await client.returnSource();
            notice(
              result
                ? "Source return: " +
                    result.status +
                    (result.reason ? " · " + result.reason : "") +
                    " · " +
                    result.artifact
                : "Root closed; server-existing repository retained on destination",
            );
          }
        } catch (error) {
          const cached = client.read();
          if (cached.record) {
            transcript.record = cached.record;
          }
          notice("Remote observation unavailable: " + String(error) + " · saved root retained");
        }
        await Promise.race([Bun.sleep(options.pollMs ?? 1000), ended]);
      }
    })();
    await ended;
  } finally {
    closed = true;
    modal?.cancel();
    process.off("SIGTERM", signal);
    process.off("SIGHUP", signal);
    clearInterval(animation);
    tui.stop();
    await poll;
    try {
      await client.detach();
    } catch (error) {
      process.stderr.write("Presentation detached locally; remote detach unconfirmed: " + String(error) + "\n");
    }
  }
}
