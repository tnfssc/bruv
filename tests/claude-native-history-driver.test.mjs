import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { collect, verify } from "../scripts/claude-native-acceptance/history-driver.mjs";

const jsonl = (entries) => entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";

function encodeSession(id, turns, importedFrom) {
  const canonicalId = "canonical-" + id;
  const canonical = [{ type: "session", id: canonicalId }];
  const native = [];
  const importedEntries = [];
  for (const [ordinal, [uuid, parentUuid, role, marker, toolCallId]] of turns.entries()) {
    const entryId = "source-" + uuid;
    canonical.push({
      type: "message",
      id: entryId,
      parentId: parentUuid ? "source-" + parentUuid : null,
      message: {
        role,
        ...(role === "toolResult" ? { toolCallId } : {}),
        content:
          toolCallId && role === "assistant"
            ? [{ type: "toolCall", id: toolCallId, name: "execute" }]
            : [{ type: "text", text: marker }],
      },
    });
    // Imported turns are the leading checkpoint prefix; their native provenance
    // stays with the root, while their canonical source belongs to this session.
    const original = importedFrom?.native[ordinal];
    native.push({
      type: role === "assistant" ? "assistant" : "user",
      uuid,
      parentUuid,
      sessionId: id,
      message: { content: marker },
      bruv: original?.bruv ?? { sourceSessionId: canonicalId, sourceMessageId: entryId },
      ...(original ? { forkedFrom: { sessionId: importedFrom.id, messageUuid: original.uuid } } : {}),
    });
    if (original) importedEntries.push({ nativeUuid: uuid, piEntryId: entryId });
  }
  if (importedFrom)
    canonical.push({
      type: "custom",
      id: "import-map",
      customType: "bruv-native-entry-map",
      data: { entries: importedEntries },
    });
  return { canonical, native };
}

// Disk fixtures exercise evidence reading, not an actual connector/UI replay.
async function historyFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bruv-history-driver-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const state = path.join(root, "state");
  const agent = path.join(root, "agent");
  const home = path.join(root, "native-history");
  const proof = path.join(root, "proof");
  const indexes = path.join(agent, "native-sessions");
  const transcripts = path.join(home, "projects", "isolated-project");
  for (const dir of [state, proof, indexes, transcripts]) await fs.mkdir(dir, { recursive: true });
  const config = {
    state,
    proof,
    wire: path.join(root, "wire.ndjson"),
    env: { BRUV_CODING_AGENT_DIR: agent, CLAUDE_CONFIG_DIR: home },
  };
  const sessions = {};
  async function saveSession(id, turns, importedFrom) {
    const { canonical, native } = encodeSession(id, turns, importedFrom);
    const file = path.join(indexes, id + ".jsonl");
    await fs.writeFile(file, jsonl(canonical));
    await fs.writeFile(path.join(indexes, id + ".json"), JSON.stringify({ file }));
    await fs.writeFile(path.join(transcripts, id + ".jsonl"), jsonl(native));
    sessions[id] = { id, canonical, native, file, nativeFile: path.join(transcripts, id + ".jsonl") };
    return sessions[id];
  }
  const original = await saveSession("root", [
    ["r-seed", null, "user", "HISTORY_SEED orchid-73"],
    ["r-tool", "r-seed", "assistant", "", "root-execute"],
    ["r-result", "r-tool", "toolResult", "HISTORY_ROOT_AUTHORITY " + root + " HISTORY_TOOL_COMPLETED", "root-execute"],
    ["r-checkpoint", "r-result", "assistant", "HISTORY_CHECKPOINT orchid-73"],
    ["r-future-user", "r-checkpoint", "user", "HISTORY_ROOT_FUTURE"],
    ["r-future", "r-future-user", "assistant", "HISTORY_ROOT_FUTURE_RESPONSE"],
  ]);
  await saveSession(
    "child",
    [
      ["c-seed", null, "user", "HISTORY_SEED orchid-73"],
      ["c-tool", "c-seed", "assistant", "", "root-execute"],
      [
        "c-result",
        "c-tool",
        "toolResult",
        "HISTORY_ROOT_AUTHORITY " + root + " HISTORY_TOOL_COMPLETED",
        "root-execute",
      ],
      ["c-checkpoint", "c-result", "assistant", "HISTORY_CHECKPOINT orchid-73"],
      ["c-continue", "c-checkpoint", "user", "HISTORY_CHILD_CONTINUE"],
      ["c-inspect", "c-continue", "assistant", "", "child-execute"],
      [
        "c-inspected",
        "c-inspect",
        "toolResult",
        "HISTORY_AUTHORITY_INSPECTION HISTORY_AUTHORITY_EMPTY",
        "child-execute",
      ],
      ["c-ok", "c-inspected", "assistant", "HISTORY_CHILD_CONTEXT_OK"],
      ["c-future-user", "c-ok", "user", "HISTORY_CHILD_FUTURE"],
      ["c-future", "c-future-user", "assistant", "HISTORY_CHILD_FUTURE_RESPONSE"],
      ["c-rollback-user", "c-ok", "user", "HISTORY_AFTER_ROLLBACK"],
      ["c-rollback", "c-rollback-user", "assistant", "HISTORY_ROLLBACK_CONTEXT_OK"],
      ["c-reopen-user", "c-rollback", "user", "HISTORY_REOPEN"],
      ["c-reopen", "c-reopen-user", "assistant", "HISTORY_REOPEN_CONTEXT_OK"],
    ],
    { ...original, native: original.native.slice(0, 4) },
  );
  await fs.writeFile(path.join(state, "root-tool-count"), "root-tool\n");
  await fs.writeFile(
    config.wire,
    jsonl([
      {
        kind: "stdin",
        value: {
          type: "user",
          uuid: "c-seed",
          message: { content: [{ type: "text", text: "HISTORY_SEED private-credential" }] },
        },
      },
      {
        kind: "stdout",
        value: {
          type: "assistant",
          uuid: "c-inspect",
          session_id: "child",
          message: {
            content: [{ type: "tool_use", id: "child-execute", name: "execute", input: { private: root } }],
          },
        },
      },
      { kind: "stderr", value: { uuid: "r-checkpoint", type: "diagnostic", private: "private-credential" } },
    ]),
  );
  return { root, config, proof, sessions };
}

test("collection reconciles direct and imported sources and exports redacted evidence", async (t) => {
  const { root, config, proof, sessions } = await historyFixture(t);
  // A JSON file without a canonical binding must not become a session.
  await fs.writeFile(path.join(config.env.BRUV_CODING_AGENT_DIR, "native-sessions", "unrelated.json"), "{}");
  const disk = await collect(config, proof, "checkpoint");
  assert.equal(disk.stage, "checkpoint");
  assert.equal(disk.completedRootToolExecutionCount, 1);
  assert.equal(disk.actualToolUseCount, 1);
  assert.equal(disk.indexes.length, 2);
  const original = disk.indexes.find((index) => index.nativeSessionId === "root");
  const child = disk.indexes.find((index) => index.nativeSessionId === "child");
  assert.equal(
    original.canonicalSha256,
    createHash("sha256")
      .update(await fs.readFile(sessions.root.file))
      .digest("hex"),
  );
  assert.equal(original.mappings[0].mappingKind, "direct-source-entry");
  assert.equal(original.mappings.find((mapping) => mapping.nativeUuid === "r-checkpoint").observedWireUuid, false);
  assert.equal(child.canonicalParentSession, null);
  const imported = child.mappings.find((mapping) => mapping.nativeUuid === "c-seed");
  assert.deepEqual(imported, {
    nativeUuid: "c-seed",
    parentUuid: null,
    sourceSessionId: "canonical-child",
    sourceEntryId: "source-c-seed",
    originalNativeSource: { sourceSessionId: "canonical-root", sourceMessageId: "source-r-seed" },
    mappingKind: "durable-import-map",
    sourceExists: true,
    sourceRole: "user",
    nativeType: "user",
    observedWireUuid: true,
  });
  assert.equal(child.mappings.find((mapping) => mapping.nativeUuid === "c-inspect").mappingKind, "direct-source-entry");
  assert.ok(child.authorityOutputs.every((output) => !output.includes(root)));
  for (const filename of ["checkpoint.json", "history-wire-projection.json"]) {
    const text = await fs.readFile(path.join(proof, filename), "utf8");
    assert.ok(!text.includes(root));
    assert.ok(!text.includes("private-credential"));
  }
  const projectedWire = JSON.parse(await fs.readFile(path.join(proof, "history-wire-projection.json"), "utf8"));
  assert.deepEqual(projectedWire[1].content, [
    { type: "tool_use", id: "child-execute", name: "execute", markers: null },
  ]);
  assert.equal(projectedWire[1].sessionId, "child");
  assert.equal(projectedWire[0].content[0].markers[0], "HISTORY_SEED");
});

test("collection keeps missing state observable without inventing sources", async (t) => {
  const { config, proof, sessions } = await historyFixture(t);
  await fs.rm(sessions.child.nativeFile);
  await fs.rm(config.wire);
  await fs.rm(path.join(config.state, "root-tool-count"));
  const disk = await collect(config, proof);
  assert.equal(disk.stage, "disk");
  assert.equal(disk.completedRootToolExecutionCount, 0);
  assert.equal(disk.actualToolUseCount, 0);
  assert.deepEqual(disk.indexes.find((index) => index.nativeSessionId === "child").nativeEntries, []);
  assert.deepEqual(disk.indexes.find((index) => index.nativeSessionId === "child").mappings, []);
});

test("malformed persisted binding fails collection instead of yielding partial acceptance", async (t) => {
  const { config, proof } = await historyFixture(t);
  await fs.writeFile(path.join(config.env.BRUV_CODING_AGENT_DIR, "native-sessions", "root.json"), "not json");
  await assert.rejects(collect(config, proof), SyntaxError);
});

async function prepareVerification(t) {
  const fixture = await historyFixture(t);
  await collect(fixture.config, fixture.proof, "root-before-fork");
  return fixture;
}
const verifyFixture = ({ config, proof }) =>
  verify({ config, proof, t3Version: "fixture-only", t3BinarySha256: "fixture-only" });

test("verification retains seed/fork identity, paired tools and the rolled-back/reopened branch", async (t) => {
  const fixture = await prepareVerification(t);
  await verifyFixture(fixture);
  const result = JSON.parse(await fs.readFile(path.join(fixture.proof, "result.json"), "utf8"));
  assert.equal(result.passed, true);
  assert.equal(result.historyAcceptance, true);
  assert.equal(result.t3Version, "fixture-only");
});

test("verification rejects an altered original branch", async (t) => {
  const fixture = await prepareVerification(t);
  await fs.appendFile(fixture.sessions.root.file, "\n");
  await assert.rejects(verifyFixture(fixture), /original branch remains byte-identical/);
});

test("verification rejects tools without their persisted paired result", async (t) => {
  const fixture = await prepareVerification(t);
  const child = fixture.sessions.child;
  await fs.writeFile(
    child.file,
    jsonl(child.canonical.filter((entry) => entry.message?.toolCallId !== "child-execute")),
  );
  await assert.rejects(verifyFixture(fixture), assert.AssertionError);
});

test("verification rejects rollback that keeps discarded child future in the active chain", async (t) => {
  const fixture = await prepareVerification(t);
  const child = fixture.sessions.child;
  child.native.find((entry) => entry.uuid === "c-rollback-user").parentUuid = "c-future";
  await fs.writeFile(child.nativeFile, jsonl(child.native));
  await assert.rejects(verifyFixture(fixture), /active native branch excludes HISTORY_CHILD_FUTURE/);
});
