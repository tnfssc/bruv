import { beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AssistantMessageComponent,
  CustomMessageComponent,
  UserMessageComponent,
  SessionManager,
  initTheme,
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai/compat";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { TranscriptLog, type TranscriptEntry } from "../src/session/transcript";
import {
  presentCanonicalVoiceMessage,
  registerConversationRenderers,
  renderConversationTranscript,
  savePassiveConversationTranscript,
  markPassiveConversationTranscript,
  conversationTranscriptRenderer,
} from "../src/live/conversation";
import { acquireMainOwner } from "../src/live/main-owner";
import { bindInstructionContinuitySession } from "../src/agent/instruction-continuity";
import { withoutPassiveLiveHistory } from "../src/live/passive-history";

beforeAll(() => {
  const packageDir = process.env.PI_PACKAGE_DIR;
  delete process.env.PI_PACKAGE_DIR;
  try {
    initTheme("dark", false);
  } finally {
    if (packageDir !== undefined) process.env.PI_PACKAGE_DIR = packageDir;
  }
});

const rendered = (message: any) => new CustomMessageComponent(message, renderConversationTranscript).render(80);
const plain = (lines: string[]) => lines.map(stripTerminalSequences).join("\n");
const custom = (entry: TranscriptEntry) => ({
  role: "custom",
  customType: "live-transcript",
  content: entry.text,
  details: entry,
  display: !entry.superseded,
  timestamp: 1,
});

test("grouped source saves one full turn, while only active drafts occupy the viewport", () => {
  const saved: TranscriptEntry[] = [];
  const log = new TranscriptLog((entry) => saved.push(entry), { groupTurns: true });
  const text = "abcdefghij".repeat(1000);
  for (let i = 0; i < 200; i++) log.receive("Voice", { text: text.slice(i * 50, (i + 1) * 50) });
  expect(saved).toEqual([]);
  expect(log.draftView((text) => text)[0].length).toBeLessThan(2420);
  log.finish("Voice", "interrupted");
  expect(saved).toEqual([{ speaker: "Voice", text, status: "interrupted" }]);
  expect(log.draftView((text) => text)).toEqual([]);
  log.finish("Voice", "turn-boundary");
  expect(saved).toHaveLength(1);
  expect(plain(rendered(custom(saved[0])))).toContain("Interrupted");
  expect(plain(rendered(custom(saved[0])))).toContain("Audio playback unverified");
});

test("replacement keeps uncertain source but renders only the complete replacement", () => {
  const saved: TranscriptEntry[] = [];
  const log = new TranscriptLog((entry) => saved.push(entry), { groupTurns: true });
  log.receive("You", { text: "wrong draft" });
  log.receive("You", { text: "correct transcription", replace: true, finished: true });
  expect(saved.map((entry) => entry.text)).toEqual(["wrong draft", "correct transcription"]);
  expect(saved[0].superseded).toBe(true);
  expect(plain(rendered(custom(saved[0]))).trim()).toBe("");
  expect(rendered(custom(saved[1])).slice(1)).toEqual(new UserMessageComponent("correct transcription").render(80));
});

test("registered renderer delegates normal styling to native user/assistant components, not custom labels", () => {
  const registry = new Map<string, any>();
  registerConversationRenderers({ registerMessageRenderer: (type, renderer) => registry.set(type, renderer) });
  expect([...registry.keys()]).toEqual(["bruv-live-transcript", "live-provisional", "live-transcript"]);
  const entry: TranscriptEntry = {
    speaker: "Voice",
    text: "**Produced** words\n\nSecond paragraph",
    status: "suppressed",
  };
  const component = registry.get("live-transcript")(
    custom(entry),
    { expanded: false, outputPad: 1 },
    { fg: (_: string, s: string) => s },
  );
  expect(component.children[0]).toBeInstanceOf(AssistantMessageComponent);
  const native = new AssistantMessageComponent({
    role: "assistant",
    content: [{ type: "text", text: entry.text }],
  } as any);
  expect(component.children[0].render(80)).toEqual(native.render(80));
  const display = plain(rendered(custom(entry)));
  expect(display).toContain("Not played");
  expect(display).not.toContain("Voice:");
  expect(display).not.toContain("[live-transcript]");
  const historical = {
    role: "custom",
    customType: "live-provisional",
    display: true,
    content: "interrupted user transcript: uncertain input",
    details: { kind: "interrupted user transcript" },
    timestamp: 0,
  };
  expect(plain(rendered(historical))).toContain("uncertain input");
  expect(plain(rendered(historical))).not.toContain("interrupted user transcript:");
});

function ownerFixture(manager: any) {
  const events: any[] = [];
  const session = {
    sessionManager: manager,
    _emit: (event: any) => events.push(event),
    _isAgentRunActive: false,
    _toolRegistry: new Map([
      [
        "execute",
        {
          name: "execute",
          description: "offline",
          parameters: { type: "object" },
          execute: async () => ({ content: [{ type: "text", text: "done" }] }),
        },
      ],
    ]),
    _baseSystemPromptOptions: { selectedTools: ["execute"] },
    systemPrompt: "ordinary instructions",
    getActiveToolNames: () => ["execute"],
    _preparePromptAndToolLoadout: () => undefined,
    _extensionRunner: {
      emitBeforeAgentStart: async () => ({
        messages: [],
        systemPromptOptions: { selectedTools: ["execute"], forceSystemPrompt: "ordinary instructions" },
      }),
    },
    agent: {
      state: { messages: [] as any[] },
      transformContext: async (messages: any[]) => messages,
      beforeToolCall: async () => undefined,
      afterToolCall: async () => undefined,
    },
  };
  bindInstructionContinuitySession(session as any);
  return { session, events, ctx: { sessionManager: manager, isIdle: () => true } as any };
}

test("canonical finals are committed once then presented through native events, and replay the same source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-voice-conversation-"));
  const manager = SessionManager.create(dir, join(dir, "sessions"));
  const { session, events, ctx } = ownerFixture(manager);
  const committed: any[] = [];
  const owner = await acquireMainOwner({} as any, ctx, {
    onMessage: (message) => {
      expect(session.agent.state.messages).toContain(message);
      committed.push(message);
      presentCanonicalVoiceMessage(manager as any, message);
    },
  });
  try {
    owner.inputTranscript("draft", false);
    owner.outputTranscript("received", false);
    expect(events).toEqual([]);
    owner.inputTranscript("complete spoken request", true);
    owner.outputTranscript("complete produced reply", true);
    expect(committed.filter((message) => message.role === "user")).toHaveLength(1);
    expect(events.filter((event) => event.type === "message_start").map((event) => event.message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(committed[1].liveTranscript.playbackVerified).toBe(false);
    const liveReply = new AssistantMessageComponent(committed[1]).render(80);
    owner.outputTranscript("interrupted words", false);
    owner.interrupt();
    expect(plain(rendered(committed[2]))).toContain("Interrupted");
    const resumed = SessionManager.open(manager.getSessionFile()!);
    const replay = resumed.buildSessionContext().messages;
    expect(replay.filter((message) => message.role === "user")).toHaveLength(1);
    expect(
      new AssistantMessageComponent(replay.find((message) => message.role === "assistant") as any).render(80),
    ).toEqual(liveReply);
    const partial = replay.find((message: any) => message.customType === "live-provisional");
    expect(rendered(partial)).toEqual(rendered(committed[2]));
  } finally {
    owner.close();
    await owner.released;
    await rm(dir, { recursive: true, force: true });
  }
});

test("grouped paired source retains full text and uncertainty on replay without becoming model context or a user instruction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-paired-conversation-"));
  const manager = SessionManager.create(dir, join(dir, "sessions"));
  // A provider-authorized ordinary user already exists; the passive input must not duplicate it.
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "authorized request" }], timestamp: 1 });
  const saved: any[] = [];
  const sink = {
    saveTranscript: (text: string, details: any, display: boolean) => {
      manager.appendCustomMessageEntry("live-transcript", text, display, details);
      saved.push({ role: "custom", content: text, customType: "live-transcript", display, details, timestamp: 2 });
    },
  } as any;
  const log = new TranscriptLog((entry) => savePassiveConversationTranscript(sink, entry, entry.speaker === "Voice"), {
    groupTurns: true,
  });
  try {
    log.receive("You", { text: "authorized request", finished: true });
    log.receive("Voice", { text: "full received ".repeat(700) });
    log.finish("Voice", "turn-boundary");
    const replay = SessionManager.open(manager.getSessionFile()!).buildSessionContext().messages;
    const reply = replay.find(
      (message: any) => message.customType === "live-transcript" && message.details.speaker === "Voice",
    );
    expect((reply as any).content).toBe("full received ".repeat(700));
    expect(rendered(reply)).toEqual(rendered(saved[1]));
    expect(plain(rendered(reply))).toContain("Partial transcript");
    expect(plain(rendered(reply))).toContain("Audio playback unverified");
    expect(withoutPassiveLiveHistory(replay).map((message) => message.role)).toEqual(["user"]);
    expect(replay.filter((message) => message.role === "user")).toHaveLength(1);
    expect((saved[0] as any).display).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("source-reference groups render original GPT fragments once and replay without text copies", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-gpt-source-groups-"));
  const manager = SessionManager.create(dir, join(dir, "sessions"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "already admitted speech" }], timestamp: 1 });
  const { session, ctx } = ownerFixture(manager);
  const passiveOptions: any[] = [];
  (session as any).sendCustomMessage = async (message: any, options: any) => {
    passiveOptions.push(options);
    manager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
  };
  const owner = await acquireMainOwner({} as any, ctx);
  owner.delegatedVoice = true;
  const log = new TranscriptLog((entry) => markPassiveConversationTranscript(owner, entry, entry.speaker === "Voice"), {
    groupTurns: true,
  });
  const fragment = (speaker: "You" | "Voice", delta: string, startMs: number) => {
    owner.sendContext(
      JSON.stringify({
        source: "gpt_live_provisional",
        role: speaker === "You" ? "user" : "assistant",
        delta,
        startMs,
        endMs: startMs + 1,
        uncertain: true,
        playbackVerified: false,
      }),
      { customType: "live-transcript" },
    );
    log.receive(speaker, { text: delta });
  };
  try {
    fragment("You", "already admitted speech", 0);
    for (let i = 1; i <= 3; i++) fragment("Voice", "first ".repeat(600), i);
    fragment("Voice", "reply", 4);
    log.finish("Voice", "interrupted");
    fragment("Voice", "next reply", 5);
    log.finish("Voice", "suppressed");
    const branch = () => manager.getBranch().filter((entry) => entry.type === "custom_message");
    const render = conversationTranscriptRenderer(branch);
    const groups = branch().filter((entry: any) => entry.details?.groupId);
    expect(groups).toHaveLength(3);
    expect(groups.every((entry) => (entry.content as any[])[0].text === "")).toBe(true);
    expect(groups.filter((entry) => entry.display)).toHaveLength(2);
    const asMessage = (entry: any) => ({ ...entry, role: "custom" });
    const firstComponent = new CustomMessageComponent(asMessage(groups[1]), render);
    const first = firstComponent.render(80);
    const nativeFull = new AssistantMessageComponent({
      role: "assistant",
      content: [{ type: "text", text: "first ".repeat(1800) + "reply" }],
    } as any);
    expect((firstComponent as any).customComponent.children[0].render(80)).toEqual(nativeFull.render(80));
    expect(plain(first)).toContain("first reply");
    expect(plain(first)).toContain("Interrupted");
    const second = plain(new CustomMessageComponent(asMessage(groups[2]), render).render(80));
    expect(second).toContain("next reply");
    expect(second).not.toContain("first reply");
    expect(second).toContain("Not played");
    const replayManager = SessionManager.open(manager.getSessionFile()!);
    const replayRenderer = conversationTranscriptRenderer(() =>
      replayManager.getBranch().filter((entry) => entry.type === "custom_message"),
    );
    const replayGroup = replayManager
      .getBranch()
      .find((entry: any) => entry.details?.groupId === (groups[1].details as any).groupId);
    expect(new CustomMessageComponent(asMessage(replayGroup), replayRenderer).render(80)).toEqual(first);
    const raw = branch().filter((entry: any) => !entry.details?.groupId);
    expect(raw.map((entry: any) => JSON.parse(entry.content[0].text).startMs)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(passiveOptions.every((options) => options.triggerTurn === false)).toBe(true);
    expect(
      withoutPassiveLiveHistory(replayManager.buildSessionContext().messages).map((message) => message.role),
    ).toEqual(["user"]);
  } finally {
    owner.close();
    await owner.released;
    await rm(dir, { recursive: true, force: true });
  }
});

test("real Pi passive grouped delivery invokes no coding turn and emits one ordinary message after persistence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-passive-pi-conversation-"));
  let session: any;
  let owner: any;
  try {
    let pi: any;
    let ctx: any;
    const manager = SessionManager.create(dir, join(dir, "sessions"));
    const loader = new DefaultResourceLoader({
      cwd: dir,
      agentDir: dir,
      noExtensions: true,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      systemPrompt: "Offline canonical conversation",
      extensionFactories: [
        {
          name: "offline-conversation",
          factory: (api) => {
            pi = api;
            api.on("session_start", (_event, context) => {
              ctx = context;
            });
            registerConversationRenderers(api, () =>
              manager.getBranch().filter((entry) => entry.type === "custom_message"),
            );
            api.registerTool({
              name: "execute",
              label: "execute",
              description: "offline only",
              parameters: { type: "object", properties: {} } as any,
              execute: async () => ({ content: [{ type: "text", text: "offline" }], details: {} }),
            });
          },
        },
      ],
    });
    await loader.reload();
    const modelRuntime = await ModelRuntime.create({
      authPath: join(dir, "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
    });
    ({ session } = await createAgentSession({
      cwd: dir,
      agentDir: dir,
      resourceLoader: loader,
      modelRuntime,
      sessionManager: manager,
      model: getModel("openai-codex", "gpt-5.6-luna"),
      tools: ["execute"],
    }));
    await session.bindExtensions({});
    bindInstructionContinuitySession(session);
    let streams = 0;
    session.agent.streamFunction = () => {
      streams++;
      throw new Error("Offline test must never invoke a provider");
    };
    const events: any[] = [];
    session.subscribe((event: any) => {
      if (event.type === "message_start") events.push(event.message);
    });
    owner = await acquireMainOwner(pi, ctx, { onMessage: (message) => presentCanonicalVoiceMessage(manager, message) });
    owner.inputTranscript("one authorized spoken input", true);
    owner.outputTranscript("one produced direct reply", true);
    expect(events.filter((message) => message.role === "user")).toHaveLength(1);
    expect(events.filter((message) => message.role === "assistant")).toHaveLength(1);
    owner.delegatedVoice = true;
    owner.sendContext(
      JSON.stringify({
        source: "gpt_live_provisional",
        role: "assistant",
        delta: "spoken paired reply",
        startMs: 0,
        endMs: 1,
        uncertain: true,
        playbackVerified: false,
      }),
      { customType: "live-transcript" },
    );
    markPassiveConversationTranscript(
      owner,
      { speaker: "Voice", text: "spoken paired reply", status: "partial" },
      true,
    );
    await Promise.resolve();
    const grouped = events.filter((message) => message.display && message.details?.groupId);
    expect(grouped).toHaveLength(1);
    const renderer = session.extensionRunner.getMessageRenderer("live-transcript");
    const display = new CustomMessageComponent(grouped[0], renderer).render(80);
    expect(plain(display)).toContain("spoken paired reply");
    expect(plain(display)).toContain("Partial transcript");
    expect(plain(display)).not.toContain("[live-transcript]");
    expect(streams).toBe(0);
    const savedGroup = manager.getBranch().find((entry: any) => entry.details?.groupId === grouped[0].details.groupId);
    expect(savedGroup).toBeDefined();
    expect(new CustomMessageComponent({ ...savedGroup, role: "custom" } as any, renderer).render(80)).toEqual(display);
  } finally {
    if (owner) {
      owner.close();
      await owner.released;
    }
    session?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("deferred voice display follows the existing canonical tool pair rather than splitting its replay", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-voice-deferred-display-"));
  const manager = SessionManager.create(dir, join(dir, "sessions"));
  const { session, ctx } = ownerFixture(manager);
  let started!: () => void;
  let release!: () => void;
  const executing = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  session._toolRegistry.get("execute")!.execute = async () => {
    started();
    await gate;
    return { content: [{ type: "text", text: "done" }] };
  };
  const visible: any[] = [];
  const owner = await acquireMainOwner({} as any, ctx, { onMessage: (message) => visible.push(message) });
  try {
    const tool = owner.orchestration.execute({ name: "execute", args: {} });
    await executing;
    owner.outputTranscript("reply received during execution", true);
    expect(visible).toEqual([]);
    expect(
      session.agent.state.messages.filter(
        (message) => message.content?.[0]?.text === "reply received during execution",
      ),
    ).toHaveLength(0);
    release();
    await tool;
    expect(visible.map((message) => message.content[0].text)).toEqual(["reply received during execution"]);
    const source = manager.buildSessionContext().messages;
    const call = source.findIndex(
      (message: any) => message.role === "assistant" && message.content[0]?.type === "toolCall",
    );
    expect(source[call + 1].role).toBe("toolResult");
    expect((source[call + 2] as any).content[0].text).toBe("reply received during execution");
  } finally {
    release();
    owner.close();
    await owner.released;
    await rm(dir, { recursive: true, force: true });
  }
});
