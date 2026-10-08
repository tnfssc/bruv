import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { AssistantMessage, ImageContent, Message, TextContent } from "@earendil-works/pi-ai";
import { type SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import { getDiskBackedEntryMetadata } from "../history/session-manager";

export interface NativeHistoryOptions {
  /** Must be the config directory visible to the parent SDK, not just the executable. */
  configDir: string;
  cwd: string;
  sessionId: string;
  sourceSessionId: string;
  /** Only for the parent's explicit CLAUDE_CODE_PROJECT_DIR_NAME override. */
  projectKey?: string;
}
export interface NativeHistoryAppend {
  sourceMessageId: string;
  type: "user" | "assistant";
  message: Record<string, unknown>;
  /** Actual Pi usage total, omitted when unknown. */
  costUSD?: number;
  timestamp: string;
  uuid?: string;
  /** Omit for linear append; null starts a branch; otherwise an already stored native UUID. */
  parentUuid?: string | null;
}
export interface NativeEntry {
  type: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  isSidechain?: boolean;
  message?: Record<string, unknown>;
  bruv?: { sourceSessionId: string; sourceMessageId: string };
  forkedFrom?: { sessionId: string; messageUuid: string };
  [key: string]: unknown;
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(value: string): string {
  if (!uuidPattern.test(value)) throw new Error("Native session/message ID must be a UUID");
  return value;
}
function segment(value: string): string {
  if (!/^[\w-]{1,128}$/.test(value)) throw new Error("Invalid native path/agent ID");
  return value;
}
function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected transcript object");
  return value as Record<string, any>;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected transcript string");
  return value;
}
/** SDK 0.3.276's project encoding, including its long-path suffix. */
export function nativeProjectKey(cwd: string): string {
  const encoded = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  if (encoded.length <= 200) return encoded;
  let hash = 0;
  for (let i = 0; i < cwd.length; i++) hash = ((hash << 5) - hash + cwd.charCodeAt(i)) | 0;
  return encoded.slice(0, 200) + "-" + Math.abs(hash).toString(36);
}
async function location(options: Pick<NativeHistoryOptions, "configDir" | "cwd" | "sessionId" | "projectKey">) {
  if (!isAbsolute(options.configDir)) throw new Error("An explicit absolute SDK-aligned configDir is required");
  const cwd = await realpath(resolve(options.cwd));
  const projectKey = options.projectKey === undefined ? nativeProjectKey(cwd) : segment(options.projectKey);
  const projectDir = join(options.configDir.normalize("NFC"), "projects", projectKey);
  return { cwd, projectDir, filePath: join(projectDir, uuid(options.sessionId) + ".jsonl") };
}
async function entriesAt(filePath: string): Promise<NativeEntry[]> {
  const contents = await readFile(filePath, "utf8");
  return contents
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => object(JSON.parse(line)) as NativeEntry);
}
export async function readNativeHistory(
  options: Pick<NativeHistoryOptions, "configDir" | "cwd" | "sessionId" | "projectKey">,
): Promise<NativeEntry[]> {
  return entriesAt((await location(options)).filePath);
}

async function* streamedNativeEntries(filePath: string): AsyncGenerator<NativeEntry> {
  const input = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) if (line.trim()) yield object(JSON.parse(line)) as NativeEntry;
  } finally {
    lines.close();
    input.destroy();
  }
}
function messageHash(message: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(message) ?? "")
    .digest("hex");
}
interface NativeRecord {
  uuid: string;
  parentUuid?: string | null;
  type: string;
  messageHash: string;
  costUSD?: number;
}

/** Import maps are bookkeeping; looking for one must not load every task snapshot. */
export function nativeImportEntryMaps(manager: SessionManager): SessionEntry[] {
  const metadata = getDiskBackedEntryMetadata(manager);
  if (metadata)
    return metadata
      .filter((entry) => entry.type === "custom" && entry.customType === "bruv-native-entry-map")
      .map((entry) => manager.getEntry(entry.id))
      .filter((entry): entry is SessionEntry => entry !== undefined);
  return manager
    .getEntries()
    .filter((entry) => entry.type === "custom" && entry.customType === "bruv-native-entry-map");
}

/** Derived transcripts only. One writer per root/child; this class never starts or restores work. */
export class NativeHistory {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly records = new Map<string, NativeRecord>();
  private lastMessageUuid: string | null = null;
  private readonly children = new Map<string, { binding: string; writer: Promise<NativeHistory> }>();
  private readonly sourceUuids = new Map<string, string>();
  private constructor(
    readonly options: NativeHistoryOptions,
    readonly filePath: string,
    private readonly sidechain: boolean,
  ) {}
  static async open(options: NativeHistoryOptions): Promise<NativeHistory> {
    const loc = await location(options);
    const writer = new NativeHistory({ ...options, cwd: loc.cwd }, loc.filePath, false);
    await writer.load();
    return writer;
  }
  /** Reopen only with the durable entry map in the NEW imported Pi session. */
  static async resumeImported(options: NativeHistoryOptions, manager: SessionManager): Promise<NativeHistory> {
    if (manager.getSessionId() !== options.sourceSessionId) throw new Error("Imported Pi session identity mismatch");
    const loc = await location(options);
    const writer = new NativeHistory({ ...options, cwd: loc.cwd }, loc.filePath, false);
    const maps = nativeImportEntryMaps(manager);
    const map = maps
      .map((entry) => object((entry as { data?: unknown }).data))
      .find((data) => data.nativeSessionId === options.sessionId);
    if (!map || !Array.isArray(map.entries)) throw new Error("No durable Pi import entry map for this native session");
    const mappings = map.entries.map(object);
    const importedIds = new Set<string>(mappings.map((item) => text(item.nativeUuid)));
    const transcript = await entriesAt(loc.filePath);
    const imported = nativeHistoryToPi(
      transcript.filter((entry) => entry.uuid && importedIds.has(entry.uuid)),
      options.sessionId,
    );
    if (imported.messages.length !== mappings.length) throw new Error("Imported transcript changed");
    for (let i = 0; i < mappings.length; i++) {
      const mapping = mappings[i]!;
      const source = manager.getEntry(text(mapping.piEntryId));
      if (
        mapping.nativeUuid !== imported.nativeUuids[i] ||
        source?.type !== "message" ||
        JSON.stringify(source.message) !== JSON.stringify(imported.messages[i])
      )
        throw new Error("Imported transcript no longer matches canonical Pi history");
      writer.sourceUuids.set(mapping.piEntryId, mapping.nativeUuid);
    }
    await writer.load(importedIds);
    return writer;
  }
  private async load(importedIds = new Set<string>()) {
    await mkdir(resolve(this.filePath, ".."), { recursive: true, mode: 0o700 });
    try {
      // Explicit fork validation needs its full import view. Ordinary root and
      // child restore only index identity/hash metadata; stream both without
      // retaining transcript bodies alongside the already-resident Pi index.
      const entries = importedIds.size ? await entriesAt(this.filePath) : streamedNativeEntries(this.filePath);
      const selected = importedIds.size
        ? new Set(nativeHistoryToPi(entries as NativeEntry[], this.options.sessionId).nativeUuids)
        : undefined;
      for await (const entry of entries) {
        if (entry.uuid)
          this.records.set(entry.uuid, {
            uuid: entry.uuid,
            parentUuid: entry.parentUuid,
            type: entry.type,
            messageHash: messageHash(entry.message),
            ...(typeof entry.costUSD === "number" ? { costUSD: entry.costUSD } : {}),
          });
        if (entry.type !== "user" && entry.type !== "assistant") continue;
        if (
          entry.sessionId !== this.options.sessionId ||
          ((entry.bruv?.sourceSessionId !== this.options.sourceSessionId || entry.forkedFrom) &&
            !importedIds.has(entry.uuid!) &&
            (!selected || selected.has(entry.uuid!)))
        )
          throw new Error("Transcript is not this Pi session's derived view; import SDK forks into a fresh Pi session");
        this.lastMessageUuid = entry.uuid!;
        if (entry.bruv?.sourceSessionId === this.options.sourceSessionId)
          this.sourceUuids.set(entry.bruv.sourceMessageId, entry.uuid!);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  append(input: NativeHistoryAppend): Promise<string> {
    return this.appendWithResult(input).then((result) => result.uuid);
  }
  /** Replay is validated inside the same writer queue as a fresh append. */
  appendWithResult(input: NativeHistoryAppend): Promise<{ uuid: string; appended: boolean }> {
    const operation = this.queue.then(async () => {
      if (!input.sourceMessageId || !this.options.sourceSessionId)
        throw new Error("Actual source identities are required");
      if (!Number.isFinite(Date.parse(input.timestamp))) throw new Error("Invalid transcript timestamp");
      if (input.message.role !== input.type) throw new Error("Transcript role/type mismatch");
      if (
        input.costUSD !== undefined &&
        (input.type !== "assistant" || !Number.isFinite(input.costUSD) || input.costUSD < 0)
      )
        throw new Error("Invalid assistant transcript cost");
      const priorId = this.sourceUuids.get(input.sourceMessageId);
      const prior = priorId ? this.records.get(priorId) : undefined;
      if (prior) {
        // Legacy entries stay immutable: absence of cost is not permission to backfill.
        // For priced entries, a replay cannot change or erase their recorded cost.
        if (
          prior.type !== input.type ||
          prior.messageHash !== messageHash(input.message) ||
          (prior.costUSD !== undefined && prior.costUSD !== input.costUSD) ||
          (input.uuid && prior.uuid !== input.uuid) ||
          (input.parentUuid !== undefined && input.parentUuid !== prior.parentUuid)
        ) {
          throw new Error("Conflicting replay of source message");
        }
        return { uuid: prior.uuid, appended: false };
      }
      const id = uuid(input.uuid ?? randomUUID());
      if (this.records.has(id)) throw new Error("Duplicate native UUID");
      const parentUuid = input.parentUuid === undefined ? this.lastMessageUuid : input.parentUuid;
      if (parentUuid !== null && !this.records.has(parentUuid))
        throw new Error("Native parent must already exist in this transcript");
      const entry: NativeEntry = {
        type: input.type,
        uuid: id,
        parentUuid,
        sessionId: this.options.sessionId,
        timestamp: input.timestamp,
        isSidechain: this.sidechain,
        cwd: this.options.cwd,
        message: JSON.parse(JSON.stringify(input.message)),
        ...(input.costUSD === undefined ? {} : { costUSD: input.costUSD }),
        bruv: { sourceSessionId: this.options.sourceSessionId, sourceMessageId: input.sourceMessageId },
      };
      await appendFile(this.filePath, JSON.stringify(entry) + "\n", { mode: 0o600 });
      this.records.set(id, {
        uuid: id,
        parentUuid,
        type: input.type,
        messageHash: messageHash(entry.message),
        ...(input.costUSD === undefined ? {} : { costUSD: input.costUSD }),
      });
      this.lastMessageUuid = id;
      this.sourceUuids.set(input.sourceMessageId, id);
      return { uuid: id, appended: true };
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async child(binding: {
    taskId: string;
    sourceSessionId: string;
    sourceCallId: string;
    parentAgentId?: string;
  }): Promise<NativeHistory> {
    segment(binding.taskId);
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(binding.sourceCallId)) throw new Error("Invalid actual tool-use ID");
    if (binding.parentAgentId !== undefined) segment(binding.parentAgentId);
    const path = join(this.filePath.slice(0, -6), "subagents", "agent-" + binding.taskId + ".jsonl");
    const metadata = {
      toolUseId: binding.sourceCallId,
      parentAgentId: binding.parentAgentId ?? null,
      bruvSourceSessionId: binding.sourceSessionId,
    };
    const bindingKey = JSON.stringify(metadata);
    const existing = this.children.get(binding.taskId);
    if (existing) {
      if (existing.binding !== bindingKey) throw new Error("Conflicting child causal binding");
      return existing.writer;
    }
    const writer = (async () => {
      const child = new NativeHistory({ ...this.options, sourceSessionId: binding.sourceSessionId }, path, true);
      await child.load();
      const metaPath = path.slice(0, -6) + ".meta.json";
      try {
        await writeFile(metaPath, bindingKey, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (JSON.stringify(JSON.parse(await readFile(metaPath, "utf8"))) !== bindingKey)
          throw new Error("Conflicting child causal binding");
      }
      return child;
    })();
    this.children.set(binding.taskId, { binding: bindingKey, writer });
    try {
      return await writer;
    } catch (error) {
      this.children.delete(binding.taskId);
      throw error;
    }
  }
}

function contentBlocks(content: unknown): Record<string, any>[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) throw new Error("Expected native content blocks");
  return content.map(object);
}
function userBlock(block: Record<string, any>): TextContent | ImageContent {
  if (block.type === "text") return { type: "text", text: text(block.text) };
  if (block.type === "image") {
    const source = object(block.source);
    if (source.type !== "base64") throw new Error("Only stored base64 images can be imported");
    return { type: "image", data: text(source.data), mimeType: text(source.media_type) };
  }
  throw new Error("Unsupported native user/result content: " + block.type);
}
/** Select the last root leaf by parent links, not by transcript prose or source IDs. */
function activeRootConversation(entries: NativeEntry[], sessionId: string): NativeEntry[] {
  uuid(sessionId);
  const conversation = entries.filter(
    (entry) =>
      entry.type === "user" ||
      entry.type === "assistant" ||
      entry.type === "system" ||
      entry.type === "attachment" ||
      entry.type === "progress",
  );
  const byId = new Map<string, NativeEntry>();
  for (const entry of conversation) {
    if (
      !entry.uuid ||
      !uuidPattern.test(entry.uuid) ||
      byId.has(entry.uuid) ||
      entry.sessionId !== sessionId ||
      entry.isSidechain
    )
      throw new Error("Invalid root transcript identity");
    byId.set(entry.uuid, entry);
  }
  const parents = new Set(conversation.map((entry) => entry.parentUuid).filter(Boolean));
  const leaf = [...conversation].reverse().find((entry) => !parents.has(entry.uuid));
  if (!leaf) throw new Error("No importable conversation");
  const chain: NativeEntry[] = [];
  const seen = new Set<string>();
  let entry: NativeEntry | undefined = leaf;
  while (entry) {
    if (seen.has(entry.uuid!)) throw new Error("Transcript parent cycle");
    seen.add(entry.uuid!);
    chain.push(entry);
    if (entry.parentUuid === null) break;
    if (typeof entry.parentUuid !== "string" || !byId.has(entry.parentUuid))
      throw new Error("Missing transcript parent");
    entry = byId.get(entry.parentUuid);
  }
  return chain.reverse();
}

/** Strict conversation import. Unsupported compaction/attachments and incomplete tools fail before writing. */
export function nativeHistoryToPi(
  entries: NativeEntry[],
  sessionId: string,
): { messages: Message[]; nativeUuids: string[] } {
  const chain = activeRootConversation(entries, sessionId);
  // One native user record can expand into several Pi user/tool-result messages.
  const converted: { message: Message; nativeUuid: string }[] = [];
  const calls = new Map<string, string>();
  const pending = new Set<string>();
  for (const item of chain) {
    if ((item.type !== "user" && item.type !== "assistant") || item.isMeta || item.isCompactSummary)
      throw new Error("Unsupported transcript context; cannot silently discard it");
    const message = object(item.message);
    if (message.role !== item.type) throw new Error("Transcript role/type mismatch");
    const timestamp = Date.parse(text(item.timestamp));
    if (!Number.isFinite(timestamp)) throw new Error("Invalid transcript timestamp");
    const blocks = contentBlocks(message.content);
    const push = (message: Message) => {
      converted.push({ message, nativeUuid: item.uuid! });
    };
    if (item.type === "assistant") {
      const content: AssistantMessage["content"] = blocks.map((block) => {
        if (block.type === "text") return { type: "text", text: text(block.text) };
        if (block.type === "thinking")
          return {
            type: "thinking",
            thinking: text(block.thinking),
            ...(block.signature !== undefined ? { thinkingSignature: text(block.signature) } : {}),
          };
        if (block.type === "redacted_thinking")
          return { type: "thinking", thinking: "", redacted: true, thinkingSignature: text(block.data) };
        if (block.type === "tool_use") {
          const id = text(block.id),
            name = text(block.name);
          if (!id || calls.has(id)) throw new Error("Duplicate/empty tool-use ID");
          calls.set(id, name);
          pending.add(id);
          return { type: "toolCall", id, name, arguments: object(block.input) };
        }
        throw new Error("Unsupported native assistant content: " + block.type);
      });
      const usage = message.usage ?? {};
      const count = (name: string) => {
        const value = usage[name] ?? 0;
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
          throw new Error("Invalid transcript usage");
        return value;
      };
      const input = count("input_tokens"),
        output = count("output_tokens"),
        cacheRead = count("cache_read_input_tokens"),
        cacheWrite = count("cache_creation_input_tokens");
      push({
        role: "assistant",
        content,
        api: "anthropic-messages",
        provider: "bruv-native-import",
        model: typeof message.model === "string" ? message.model : "imported",
        ...(typeof message.id === "string" ? { responseId: message.id } : {}),
        usage: {
          input,
          output,
          cacheRead,
          cacheWrite,
          totalTokens: input + output + cacheRead + cacheWrite,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: content.some((block) => block.type === "toolCall")
          ? "toolUse"
          : message.stop_reason === "max_tokens"
            ? "length"
            : "stop",
        timestamp,
      });
    } else {
      if (blocks.length === 0) push({ role: "user", content: [], timestamp });
      let user: (TextContent | ImageContent)[] = [];
      const flush = () => {
        if (user.length) {
          push({ role: "user", content: user, timestamp });
          user = [];
        }
      };
      for (const block of blocks) {
        if (block.type !== "tool_result") {
          user.push(userBlock(block));
          continue;
        }
        flush();
        const id = text(block.tool_use_id);
        if (!pending.delete(id)) throw new Error("Tool result has no pending actual tool-use ID");
        push({
          role: "toolResult",
          toolCallId: id,
          toolName: calls.get(id)!,
          content: contentBlocks(block.content ?? "").map(userBlock),
          isError: block.is_error === true,
          timestamp,
        });
      }
      flush();
    }
  }
  if (pending.size)
    throw new Error("Cannot import an incomplete tool exchange: imported tools must never be reexecuted");
  return {
    messages: converted.map((entry) => entry.message),
    nativeUuids: converted.map((entry) => entry.nativeUuid),
  };
}

export interface NativeImportResult {
  sessionManager: SessionManager;
  sourceSessionId: string;
  sourceSessionFile: string;
  /** New Pi entry IDs, never task/owner IDs. */
  entries: { nativeUuid: string; piEntryId: string }[];
  history: NativeHistory;
  ownership: "imported-history-only";
}
/** Import into NEW Pi history, not a scheduler restore or an old session adoption. */
export async function importNativeHistory(
  options: Pick<NativeHistoryOptions, "configDir" | "cwd" | "sessionId" | "projectKey"> & { sessionDir: string },
): Promise<NativeImportResult> {
  const loc = await location(options);
  const transcript = await entriesAt(loc.filePath);
  const { messages, nativeUuids } = nativeHistoryToPi(transcript, options.sessionId);
  const manager = SessionManager.create(loc.cwd, options.sessionDir);
  manager.appendCustomEntry("bruv-native-import", {
    nativeSessionId: options.sessionId,
    ownership: "imported-history-only",
    forkedFrom: transcript
      .filter((entry) => entry.forkedFrom)
      .map((entry) => ({ uuid: entry.uuid, forkedFrom: entry.forkedFrom })),
  });
  const entries = messages.map((message, index) => ({
    nativeUuid: nativeUuids[index]!,
    piEntryId: manager.appendMessage(message),
  }));
  manager.appendCustomEntry("bruv-native-entry-map", { nativeSessionId: options.sessionId, entries });
  const history = await NativeHistory.resumeImported({ ...options, sourceSessionId: manager.getSessionId() }, manager);
  return {
    history,
    sessionManager: manager,
    sourceSessionId: manager.getSessionId(),
    sourceSessionFile: manager.getSessionFile()!,
    entries,
    ownership: "imported-history-only",
  };
}
