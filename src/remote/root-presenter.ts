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
  Text,
  TuiMainScreen,
} from "@earendil-works/pi-tui";
import { QuestionPicker } from "../questions/picker";
import type { RootClient } from "./root-client";
import type { RootCommand, RootDialog, RootObservation, RootRecord } from "./root-contract";

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
      if (
        !current ||
        current.status !== "pending" ||
        current.version !== q.version ||
        !isDeepStrictEqual(current.owner, q.owner)
      )
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
      if (c.type === "toolCall")
        return details
          ? "Tool: " + safe(c.name) + " " + safe(JSON.stringify(c.arguments))
          : "Running " + safe(c.arguments?.label ?? c.name);
      return "";
    })
    .filter(Boolean)
    .join("\n");
}
/** Bounded conversation projection, independent of provider settings. Server snapshot wins. */
export class RootTranscript {
  messages: any[] = [];
  streaming?: any;
  progress = "";
  record?: RootRecord;
  details = false;
  apply(observation: RootObservation) {
    this.record = observation.record;
    for (const { event } of observation.events) this.event(event);
    const snapshot = (observation.record as any).messages;
    if (Array.isArray(snapshot)) this.messages = snapshot.slice(-200);
  }
  event(event: any) {
    if (!event || typeof event !== "object") return;
    if (event.type === "message_start" || event.type === "message_update") this.streaming = event.message;
    if (event.type === "message_end") {
      this.messages.push(event.message);
      this.messages = this.messages.slice(-200);
      this.streaming = undefined;
    }
    if (event.type === "tool_execution_start") this.progress = "Running " + safe(event.toolName);
    if (event.type === "tool_execution_update") this.progress = "Running " + safe(event.toolName);
    if (event.type === "tool_execution_end")
      this.progress = "Tool " + safe(event.toolName) + (event.isError ? " failed" : " completed");
    if (event.type === "agent_start") this.progress = "Assistant working";
    if (event.type === "agent_end") this.progress = "Ready";
    if (event.type === "task" || event.type === "job" || event.type === "question")
      this.progress = safe(event.title ?? event.text ?? event.status ?? event.type);
  }
  toggleDetails() {
    this.details = !this.details;
  }
  render(width: number): string[] {
    const lines: string[] = [];
    const messages = [...this.messages, ...(this.streaming ? [this.streaming] : [])];
    const labels = new Map<string, string>();
    for (const m of messages) {
      if (!m || m.display === false || !Array.isArray(m.content)) continue;
      for (const c of m.content)
        if (c.type === "toolCall" && c.id) labels.set(c.id, safe(c.arguments?.label ?? c.name));
    }
    for (const m of messages) {
      if (!m || m.display === false) continue;
      const role =
        m.role === "user"
          ? "You"
          : m.role === "assistant"
            ? "Assistant"
            : m.role === "toolResult"
              ? "Action"
              : "Notice";
      lines.push(...new Text(accent(role), 0, 0).render(width));
      let text: string;
      if (m.role === "toolResult") {
        const name = labels.get(m.toolCallId) ?? safe(m.toolName ?? "tool");
        const output = typeof m.content === "string" ? safe(m.content) : messageText(m, this.details);
        text =
          (m.isError ? name + " failed" : name + " completed") +
          ((this.details || m.isError) && output ? "\n" + output : "");
        if (this.details && m.toolCallId) text = "Tool call " + safe(m.toolCallId) + "\n" + text;
      } else text = messageText(m, this.details);
      lines.push(
        ...(m.role === "assistant" ? new Markdown(text, 0, 0, markdownTheme) : new Text(text, 0, 0)).render(width),
        "",
      );
    }
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
  let closed = false,
    modal: Component | undefined;
  let finish!: () => void;
  let cancelModal: (() => void) | undefined;
  const ended = new Promise<void>((resolve) => (finish = resolve));
  const notice = (text: string) => {
    status.setText(safe(text));
    tui.requestRender();
  };
  const detach = () => {
    closed = true;
    cancelModal?.();
    finish();
  };
  const pick = (
    title: string,
    items: Array<{ value: string; label: string; description?: string }>,
  ): Promise<string | undefined> =>
    new Promise((resolve) => {
      const done = (value?: string) => {
        modal = undefined;
        cancelModal = undefined;
        tui.setFocus(editor);
        tui.requestRender();
        resolve(value);
      };
      modal = new QuestionPicker(
        safe(title),
        items,
        theme,
        getKeybindings(),
        done,
        () => tui.requestRender(),
        () => process.stdout.rows || 24,
      );
      cancelModal = () => done();
      tui.setFocus(modal);
      tui.requestRender();
    });
  const answer = async (q: Question): Promise<string | undefined> => {
    if (q.choices?.length) {
      const items = q.choices.map((label, i) => ({ value: String(i), label: safe(label) }));
      if (q.allowFreeText !== false) items.push({ value: "free", label: "Type an answer" });
      const selected = await pick(q.text, items);
      if (selected === undefined) return;
      if (selected !== "free") return q.choices[Number(selected)];
    }
    if (q.allowFreeText === false) return;
    return new Promise((resolve) => {
      const input = new Editor(tui, editorTheme);
      const done = (value?: string) => {
        modal = undefined;
        cancelModal = undefined;
        tui.setFocus(editor);
        tui.requestRender();
        resolve(value);
      };
      input.onSubmit = (text) => done(text.trim() ? text : undefined);
      modal = {
        render: (width) => [...new Text(safe(q.text)).render(width), ...input.render(width)],
        handleInput: (data) => input.handleInput(data),
        invalidate: () => input.invalidate(),
      };
      cancelModal = () => done();
      tui.setFocus(modal);
      tui.requestRender();
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
      if (modal) return modal.render(width);
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
      if (modal) modal.handleInput?.(data);
      else editor.handleInput(data);
    },
    invalidate() {
      editor.invalidate();
      modal?.invalidate();
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
        cancelModal?.();
        return { consume: true };
      }
      void controls.submit("/abort").catch((error) => notice(String(error)));
      return { consume: true };
    }
    if (data === "\x1b" && modal) {
      cancelModal?.();
      return { consume: true };
    }
    return;
  });
  const signal = () => detach();
  process.on("SIGTERM", signal);
  process.on("SIGHUP", signal);
  tui.start();
  let poll: Promise<void> | undefined;
  try {
    for (const e of client.read().events) transcript.event(e.event);
    if (client.read().record) {
      transcript.record = client.read().record;
      const snapshot = (transcript.record as any).messages;
      if (Array.isArray(snapshot)) transcript.messages = snapshot.slice(-200);
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
            if (Array.isArray((cached.record as any).messages))
              transcript.messages = (cached.record as any).messages.slice(-200);
          }
          notice("Remote observation unavailable: " + String(error) + " · saved root retained");
        }
        await Promise.race([Bun.sleep(options.pollMs ?? 1000), ended]);
      }
    })();
    await ended;
  } finally {
    closed = true;
    cancelModal?.();
    process.off("SIGTERM", signal);
    process.off("SIGHUP", signal);
    tui.stop();
    await poll;
    try {
      await client.detach();
    } catch (error) {
      process.stderr.write("Presentation detached locally; remote detach unconfirmed: " + String(error) + "\n");
    }
  }
}
