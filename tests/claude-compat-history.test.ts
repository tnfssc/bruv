import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  NativeHistory,
  importNativeHistory,
  nativeHistoryToPi,
  nativeProjectKey,
  readNativeHistory,
} from "../src/claude-compat/history";

const sdkPath = resolve(process.env.BRUV_CLAUDE_SDK_PATH ?? ".cache/claude-compat-boundary/package/sdk.mjs");
const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "bruv-native-history-"));
  tempDirs.push(dir);
  const cwd = join(dir, "project with spaces_é");
  await mkdir(cwd);
  const options = {
    configDir: join(dir, "isolated-config"),
    cwd,
    sessionId: randomUUID(),
    sourceSessionId: randomUUID(),
  };
  const history = await NativeHistory.open(options);
  return { dir, options, history };
}
const stamp = "2026-10-03T12:00:00.000Z";
function user(sourceMessageId: string, content: unknown = "hello", extra = {}) {
  return { sourceMessageId, type: "user" as const, message: { role: "user", content }, timestamp: stamp, ...extra };
}
function assistant(sourceMessageId: string, content: unknown = [{ type: "text", text: "answer" }], extra = {}) {
  return {
    sourceMessageId,
    type: "assistant" as const,
    message: {
      role: "assistant",
      id: "actual-response-" + sourceMessageId,
      model: "fixture-only",
      content,
      stop_reason: "end_turn",
      usage: { input_tokens: 3, output_tokens: 4 },
    },
    timestamp: stamp,
    ...extra,
  };
}
// Deliberately run the REAL pinned SDK in a separate Node process. No query/model/credentials.
// Prepare: npm pack @anthropic-ai/claude-agent-sdk@0.3.276; extract under .cache/claude-compat-boundary/.
async function sdk(
  environment: { HOME: string; CLAUDE_CONFIG_DIR?: string; CLAUDE_CODE_PROJECT_DIR_NAME?: string },
  actions: { method: string; args: unknown[] }[],
): Promise<any[]> {
  const metadata = JSON.parse(await readFile(join(dirname(sdkPath), "package.json"), "utf8"));
  if (metadata.name !== "@anthropic-ai/claude-agent-sdk" || metadata.version !== "0.3.276")
    throw new Error("History proof requires exact native SDK 0.3.276");
  const process_ = Bun.spawn(
    [
      process.env.BRUV_HISTORY_NODE ?? "node",
      "--input-type=module",
      "-e",
      `
        const sdk = await import(process.argv[1]);
        const actions = JSON.parse(process.argv[2]);
        const results = [];
        for (const action of actions) {
          try {
            results.push(await sdk[action.method](...action.args));
          } catch (error) {
            results.push({ error: error.message });
          }
        }
        console.log(JSON.stringify(results));
      `,
      sdkPath,
      JSON.stringify(actions),
    ],
    {
      env: {
        PATH: process.env.PATH,
        ...environment,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [out, err, exit] = await Promise.all([
    new Response(process_.stdout).text(),
    new Response(process_.stderr).text(),
    process_.exited,
  ]);
  if (exit !== 0) throw new Error("SDK process failed: " + err);
  return JSON.parse(out);
}
const rootRead = (sessionId: string, cwd: string, extra = {}) => ({
  method: "getSessionMessages",
  args: [sessionId, { dir: cwd, ...extra }],
});
const fork = (sessionId: string, cwd: string, extra = {}) => ({
  method: "forkSession",
  args: [sessionId, { dir: cwd, ...extra }],
});

describe.skipIf(!existsSync(sdkPath) && process.env.BRUV_REQUIRE_CLAUDE_SDK !== "1")(
  "native SDK 0.3.276 filesystem history",
  () => {
    test("root and supplied child bindings survive reopen; SDK reads exact IDs/causal chains", async () => {
      const { options, history } = await fixture();
      const promptId = randomUUID();
      const u = await history.append(user("pi-u", "root prompt", { uuid: promptId }));
      const a = await history.append(
        assistant("pi-a", [
          { type: "tool_use", id: "real-call-1", name: "functions.subagent", input: { prompt: "work" } },
        ]),
      );
      const child = await history.child({
        taskId: "task_actual_child",
        sourceSessionId: "actual-pi-child",
        sourceCallId: "real-call-1",
      });
      const cu = await child.append(user("pi-child-u", "child prompt"));
      const ca = await child.append(assistant("pi-child-a", [{ type: "text", text: "child answer" }]));
      const nested = await child.child({
        taskId: "task_actual_nested",
        sourceSessionId: "actual-pi-nested",
        sourceCallId: "real-call-2",
        parentAgentId: "task_actual_child",
      });
      await nested.append(user("nested-u", "nested prompt"));
      await nested.append(assistant("nested-a"));
      const r = await history.append(
        user("pi-r", [{ type: "tool_result", tool_use_id: "real-call-1", content: "child answer" }]),
      );
      const final = await history.append(assistant("pi-final"));
      const reopened = await NativeHistory.open(options);
      expect(await reopened.append(user("pi-u", "root prompt", { uuid: promptId }))).toBe(u);
      const [messages, page, agents, childMessages, nestedMessages] = await sdk(
        { HOME: options.configDir, CLAUDE_CONFIG_DIR: options.configDir },
        [
          rootRead(options.sessionId, options.cwd),
          rootRead(options.sessionId, options.cwd, { offset: 1, limit: 2 }),
          { method: "listSubagents", args: [options.sessionId, { dir: options.cwd }] },
          { method: "getSubagentMessages", args: [options.sessionId, "task_actual_child", { dir: options.cwd }] },
          { method: "getSubagentMessages", args: [options.sessionId, "task_actual_nested", { dir: options.cwd }] },
        ],
      );
      expect(messages.map((m: any) => m.uuid)).toEqual([u, a, r, final]);
      expect(messages.every((m: any) => m.session_id === options.sessionId && m.parent_tool_use_id === null)).toBe(
        true,
      );
      expect(page.map((m: any) => m.uuid)).toEqual([a, r]);
      expect(agents.sort()).toEqual(["task_actual_child", "task_actual_nested"].sort());
      expect(childMessages.map((m: any) => m.uuid)).toEqual([cu, ca]);
      expect(
        childMessages.every((m: any) => m.parent_tool_use_id === "real-call-1" && m.parent_agent_id === null),
      ).toBe(true);
      expect(
        nestedMessages.every(
          (m: any) => m.parent_tool_use_id === "real-call-2" && m.parent_agent_id === "task_actual_child",
        ),
      ).toBe(true);
      const records = await readNativeHistory(options);
      expect(records.map((m) => m.parentUuid)).toEqual([null, u, a, r]);
      expect(records[1]!.bruv).toEqual({ sourceSessionId: options.sourceSessionId, sourceMessageId: "pi-a" });
      expect((await readNativeHistory(options)).length).toBe(4);
    });

    test("SDK checkpoint fork retains provenance, imports completed tools into fresh durable Pi, resumes without authority", async () => {
      const { dir, options, history } = await fixture();
      const u = await history.append(user("pi-u"));
      const a = await history.append(
        assistant("pi-tool", [
          { type: "text", text: "running tool" },
          { type: "tool_use", id: "actual-tool", name: "bash", input: { command: "echo already-ran" } },
        ]),
      );
      const r = await history.append(
        user("pi-result", [
          { type: "tool_result", tool_use_id: "actual-tool", content: "already-ran", is_error: false },
        ]),
      );
      const checkpoint = await history.append(assistant("pi-finish"));
      await history.append(user("pi-excluded", "must not be imported"));
      const child = await history.child({
        taskId: "task_actual",
        sourceSessionId: "real-child",
        sourceCallId: "actual-tool",
      });
      await child.append(user("cu"));
      const [created] = await sdk({ HOME: options.configDir, CLAUDE_CONFIG_DIR: options.configDir }, [
        fork(options.sessionId, options.cwd, { upToMessageId: checkpoint, title: "actual SDK fork" }),
      ]);
      expect(created.error).toBeUndefined();
      expect(created.sessionId).not.toBe(options.sessionId);
      const forkOptions = { ...options, sessionId: created.sessionId };
      const records = await readNativeHistory(forkOptions);
      const conversation = records.filter((e) => e.type === "user" || e.type === "assistant");
      expect(conversation).toHaveLength(4);
      expect(conversation.map((e) => e.forkedFrom)).toEqual(
        [u, a, r, checkpoint].map((messageUuid) => ({ sessionId: options.sessionId, messageUuid })),
      );
      expect(conversation.every((e) => ![u, a, r, checkpoint].includes(e.uuid!))).toBe(true);
      expect(conversation.map((e) => e.parentUuid)).toEqual([null, ...conversation.slice(0, -1).map((e) => e.uuid)]);
      expect(conversation[1]!.bruv?.sourceMessageId).toBe("pi-tool");
      await expect(NativeHistory.open(forkOptions)).rejects.toThrow("import SDK forks");
      const result = await importNativeHistory({ ...forkOptions, sessionDir: join(dir, "new-pi") });
      expect(result.ownership).toBe("imported-history-only");
      expect(result.sourceSessionId).not.toBe(options.sourceSessionId);
      const pi = SessionManager.open(result.sourceSessionFile);
      const piMessages = pi
        .getBranch()
        .filter((e) => e.type === "message")
        .map((e: any) => e.message);
      expect(piMessages.map((m) => m.role)).toEqual(["user", "assistant", "toolResult", "assistant"]);
      expect(piMessages[1].content[1]).toEqual({
        type: "toolCall",
        id: "actual-tool",
        name: "bash",
        arguments: { command: "echo already-ran" },
      });
      expect(piMessages[2].toolCallId).toBe("actual-tool");
      expect(piMessages[2].content).toEqual([{ type: "text", text: "already-ran" }]);
      expect(pi.getHeader()!.parentSession).toBeUndefined();
      expect(
        pi
          .getEntries()
          .filter((e) => e.type !== "message")
          .map((e: any) => e.customType),
      ).toEqual(["bruv-native-import", "bruv-native-entry-map"]);
      const nextPiId = pi.appendMessage({ role: "user", content: "new owner prompt", timestamp: Date.parse(stamp) });
      const resumed = await NativeHistory.resumeImported({ ...forkOptions, sourceSessionId: pi.getSessionId() }, pi);
      const nextNativeId = await resumed.append(user(nextPiId, "new owner prompt"));
      const [messages, children] = await sdk({ HOME: options.configDir, CLAUDE_CONFIG_DIR: options.configDir }, [
        rootRead(created.sessionId, options.cwd),
        { method: "listSubagents", args: [created.sessionId, { dir: options.cwd }] },
      ]);
      expect(messages.map((m: any) => m.uuid)).toEqual([...conversation.map((e) => e.uuid), nextNativeId]);
      expect(children).toEqual([]); // SDK forks do not copy running child/task ownership.
      const again = await NativeHistory.resumeImported(
        { ...forkOptions, sourceSessionId: pi.getSessionId() },
        SessionManager.open(result.sourceSessionFile),
      );
      expect(await again.append(user(nextPiId, "new owner prompt"))).toBe(nextNativeId);
      const [grandchild] = await sdk({ HOME: options.configDir, CLAUDE_CONFIG_DIR: options.configDir }, [
        fork(created.sessionId, options.cwd),
      ]);
      const secondImport = await importNativeHistory({
        ...forkOptions,
        sessionId: grandchild.sessionId,
        sessionDir: join(dir, "second-pi"),
      });
      expect(secondImport.sourceSessionId).not.toBe(result.sourceSessionId);
    });

    test("SDK fork at a pending tool checkpoint fails safe before creating Pi storage", async () => {
      const { dir, options, history } = await fixture();
      await history.append(user("u"));
      const pending = await history.append(
        assistant("tool", [{ type: "tool_use", id: "pending-call", name: "bash", input: { command: "dangerous" } }]),
      );
      const [created, badCheckpoint] = await sdk({ HOME: options.configDir, CLAUDE_CONFIG_DIR: options.configDir }, [
        fork(options.sessionId, options.cwd, { upToMessageId: pending }),
        fork(options.sessionId, options.cwd, { upToMessageId: randomUUID() }),
      ]);
      expect(created.error).toBeUndefined();
      expect(badCheckpoint.error).toContain("not found");
      const sessionDir = join(dir, "must-not-exist");
      await expect(importNativeHistory({ ...options, sessionId: created.sessionId, sessionDir })).rejects.toThrow(
        "incomplete tool exchange",
      );
      expect(existsSync(sessionDir)).toBe(false);
    });

    test("parent SDK config-home mismatch really misses files; explicit aligned override works", async () => {
      const { dir, options, history } = await fixture();
      await history.append(user("u"));
      const wrong = join(dir, "sdk-other-home");
      await mkdir(wrong);
      const [missing, failedFork] = await sdk({ HOME: wrong, CLAUDE_CONFIG_DIR: wrong }, [
        rootRead(options.sessionId, options.cwd),
        fork(options.sessionId, options.cwd),
      ]);
      expect(missing).toEqual([]);
      expect(failedFork.error).toContain("not found");
      const customOptions = { ...options, sessionId: randomUUID(), projectKey: "connector-owned-project" };
      const custom = await NativeHistory.open(customOptions);
      const id = await custom.append(user("custom-u"));
      const [aligned] = await sdk(
        {
          HOME: options.configDir,
          CLAUDE_CONFIG_DIR: options.configDir,
          CLAUDE_CODE_PROJECT_DIR_NAME: customOptions.projectKey,
        },
        [rootRead(customOptions.sessionId, options.cwd)],
      );
      expect(aligned.map((m: any) => m.uuid)).toEqual([id]);
    });

    test("without parent config, SDK dir is a project selector, not a provider config home", async () => {
      const { dir, options, history } = await fixture();
      const nativeId = await history.append(user("isolated-root"));
      const child = await history.child({
        taskId: "isolated-child",
        sourceSessionId: randomUUID(),
        sourceCallId: "actual-launch-call",
      });
      await child.append(user("isolated-child-user"));
      // Only a throwaway HOME is used. The real user's Claude directory is never read or written.
      const home = join(dir, "ordinary-home");
      const ordinaryClaude = join(home, ".claude");
      await mkdir(ordinaryClaude, { recursive: true });
      const sentinel = '{"fixture":"ordinary Claude settings must stay untouched"}\n';
      await writeFile(join(ordinaryClaude, "settings.json"), sentinel);
      const transcript = join(options.configDir, "projects", nativeProjectKey(options.cwd));
      // Supplying only HOME leaves CLAUDE_CONFIG_DIR out of the allowlisted environment,
      // regardless of any inherited test-runner variable. This matches normal T3's SDK process.
      const [missing, missingChild, failedFork, configAsDir, projectAsDir] = await sdk({ HOME: home }, [
        rootRead(options.sessionId, options.cwd),
        { method: "getSubagentMessages", args: [options.sessionId, "isolated-child", { dir: options.cwd }] },
        fork(options.sessionId, options.cwd),
        fork(options.sessionId, options.configDir),
        fork(options.sessionId, transcript),
      ]);
      expect(missing).toEqual([]);
      expect(missingChild).toEqual([]);
      for (const failed of [failedFork, configAsDir, projectAsDir]) expect(failed.error).toContain("not found");
      expect(await readFile(join(ordinaryClaude, "settings.json"), "utf8")).toBe(sentinel);
      expect(await readdir(ordinaryClaude)).toEqual(["settings.json"]);
      // Keep a positive control: the same genuine transcript, SDK, and checkpoint work when
      // explicitly scoped in a separate process. This is not a proposed T3 launch workaround.
      const [read, forked] = await sdk({ HOME: options.configDir, CLAUDE_CONFIG_DIR: options.configDir }, [
        rootRead(options.sessionId, options.cwd),
        fork(options.sessionId, options.cwd, { upToMessageId: nativeId }),
      ]);
      expect(read.map((message: any) => message.uuid)).toEqual([nativeId]);
      expect(forked.error).toBeUndefined();
      expect(forked.sessionId).not.toBe(options.sessionId);
    });

    test("SDK reads canonical symlink cwd and long encoded paths", async () => {
      const { dir, options } = await fixture();
      const longCwd = join(dir, "a".repeat(150), "b".repeat(100));
      await mkdir(longCwd, { recursive: true });
      const alias = join(dir, "alias");
      await symlink(longCwd, alias);
      const history = await NativeHistory.open({ ...options, cwd: alias });
      expect(nativeProjectKey(longCwd).length).toBeGreaterThan(200);
      const id = await history.append(user("u"));
      const [messages] = await sdk({ HOME: options.configDir, CLAUDE_CONFIG_DIR: options.configDir }, [
        rootRead(options.sessionId, alias),
      ]);
      expect(messages.map((m: any) => m.uuid)).toEqual([id]);
    });

    test("real parent chains select a branch, not matching prose", async () => {
      const { dir, options, history } = await fixture();
      const root = await history.append(user("root", "same prose"));
      await history.append(assistant("discarded", [{ type: "text", text: "not on selected branch" }]));
      const selected = await history.append(
        assistant("selected", [{ type: "text", text: "selected branch" }], { parentUuid: root }),
      );
      const [messages, created] = await sdk({ HOME: options.configDir, CLAUDE_CONFIG_DIR: options.configDir }, [
        rootRead(options.sessionId, options.cwd),
        fork(options.sessionId, options.cwd),
      ]);
      expect(messages.map((m: any) => m.uuid)).toEqual([root, selected]);
      const imported = await importNativeHistory({
        ...options,
        sessionId: created.sessionId,
        sessionDir: join(dir, "pi"),
      });
      expect(imported.entries).toHaveLength(2);
      const content = imported.sessionManager
        .getBranch()
        .filter((e) => e.type === "message")
        .map((e: any) => e.message.content);
      expect(JSON.stringify(content)).not.toContain("not on selected branch");
    });
  },
);

describe("history boundaries", () => {
  test("active parent chain expands user/results with durable native provenance", async () => {
    const { dir, options, history } = await fixture();
    const root = await history.append(user("root"));
    // The abandoned branch is incomplete, but must not contribute context or pending tools.
    await history.append(assistant("abandoned", [{ type: "tool_use", id: "abandoned-call", name: "bash", input: {} }]));
    const active = await history.append(
      assistant("active", [{ type: "tool_use", id: "active-call", name: "bash", input: {} }], { parentUuid: root }),
    );
    const mixed = await history.append(
      user("mixed", [
        { type: "text", text: "before" },
        { type: "tool_result", tool_use_id: "active-call", content: "recorded output" },
        { type: "text", text: "after" },
      ]),
    );
    const empty = await history.append(user("empty", []));
    const transcript = await readNativeHistory(options);
    const converted = nativeHistoryToPi(transcript, options.sessionId);
    expect(converted.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "toolResult",
      "user",
      "user",
    ]);
    expect(converted.nativeUuids).toEqual([root, active, mixed, mixed, mixed, empty]);
    expect(converted.messages[2]!.content).toEqual([{ type: "text", text: "before" }]);
    expect(converted.messages[3]).toMatchObject({
      role: "toolResult",
      toolCallId: "active-call",
      toolName: "bash",
      content: [{ type: "text", text: "recorded output" }],
    });
    expect(converted.messages[4]!.content).toEqual([{ type: "text", text: "after" }]);
    expect(converted.messages[5]!.content).toEqual([]);

    const imported = await importNativeHistory({ ...options, sessionDir: join(dir, "pi") });
    expect(imported.entries.map((entry) => entry.nativeUuid)).toEqual(converted.nativeUuids);
    expect(new Set(imported.entries.map((entry) => entry.piEntryId)).size).toBe(6);
    await NativeHistory.resumeImported(
      { ...options, sourceSessionId: imported.sourceSessionId },
      imported.sessionManager,
    );
  });

  test("source replay compares stored JSON property order", async () => {
    const { history } = await fixture();
    const original = user("u", [{ type: "text", text: "hello" }]);
    const id = await history.append(original);
    expect(await history.append(original)).toBe(id);
    await expect(
      history.append({
        ...original,
        message: { content: original.message.content, role: "user" },
      }),
    ).rejects.toThrow("Conflicting replay");
  });

  test("source replay, duplicate UUID, parent and child causality conflicts are rejected", async () => {
    const { options, history } = await fixture();
    const id = await history.append(user("actual-source"));
    await expect(history.append(user("actual-source", "different"))).rejects.toThrow("Conflicting replay");
    await expect(history.append(user("other", "hello", { uuid: id }))).rejects.toThrow("Duplicate");
    await expect(history.append(user("other", "hello", { parentUuid: randomUUID() }))).rejects.toThrow("parent");
    await history.child({ taskId: "actual_task", sourceSessionId: "child-pi", sourceCallId: "actual-call" });
    await expect(
      history.child({ taskId: "actual_task", sourceSessionId: "child-pi", sourceCallId: "guessed-call" }),
    ).rejects.toThrow("Conflicting child");
    await expect(
      history.child({ taskId: "../escape", sourceSessionId: "child-pi", sourceCallId: "call" }),
    ).rejects.toThrow("Invalid");
    await expect(NativeHistory.open({ ...options, sourceSessionId: "unrelated-pi" })).rejects.toThrow(
      "not this Pi session",
    );
    expect((await readNativeHistory(options)).length).toBe(1);
  });

  test("unknown transcript context, dangling links and unknown tool results cannot be imported", async () => {
    const { options, history } = await fixture();
    const u = await history.append(user("u"));
    const entries = await readNativeHistory(options);
    expect(() => nativeHistoryToPi([{ ...entries[0]!, parentUuid: randomUUID() }], options.sessionId)).toThrow(
      "Missing transcript parent",
    );
    expect(() =>
      nativeHistoryToPi([{ ...entries[0]!, type: "system", subtype: "compact_boundary" }], options.sessionId),
    ).toThrow("Unsupported transcript context");
    expect(() =>
      nativeHistoryToPi(
        [
          {
            ...entries[0]!,
            message: {
              role: "user",
              content: [{ type: "tool_result", tool_use_id: "invented", content: "looks like output" }],
            },
          },
        ],
        options.sessionId,
      ),
    ).toThrow("no pending actual");
    expect(() => nativeHistoryToPi([{ ...entries[0]!, parentUuid: u }], options.sessionId)).toThrow("No importable");
  });

  test("stored images/thinking/error results preserve content, and altered imports fail reopen", async () => {
    const { dir, options, history } = await fixture();
    await history.append(
      user("u", [{ type: "image", source: { type: "base64", media_type: "image/png", data: "fixture-bytes" } }]),
    );
    await history.append(
      assistant("a", [
        { type: "thinking", thinking: "recorded thought", signature: "recorded-signature" },
        { type: "redacted_thinking", data: "opaque" },
        { type: "tool_use", id: "id", name: "bash", input: {} },
      ]),
    );
    await history.append(
      user("r", [{ type: "tool_result", tool_use_id: "id", content: "actual failure", is_error: true }]),
    );
    const imported = await importNativeHistory({ ...options, sessionDir: join(dir, "pi") });
    const messages = imported.sessionManager
      .getBranch()
      .filter((e) => e.type === "message")
      .map((e: any) => e.message);
    expect(messages[0].content[0]).toEqual({ type: "image", data: "fixture-bytes", mimeType: "image/png" });
    expect(messages[1].content[0].thinkingSignature).toBe("recorded-signature");
    expect(messages[1].content[1].redacted).toBe(true);
    expect(messages[2].isError).toBe(true);
    const records = await readNativeHistory(options);
    records[0]!.message = { role: "user", content: "tampered" };
    await writeFile(history.filePath, records.map((e) => JSON.stringify(e)).join("\n") + "\n");
    await expect(
      NativeHistory.resumeImported({ ...options, sourceSessionId: imported.sourceSessionId }, imported.sessionManager),
    ).rejects.toThrow("no longer matches");
  });
});
