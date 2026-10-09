import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
export { prepare } from "./driver.mjs";
import { modelSlug } from "./model.mjs";
export async function captureIdentity({ page, proof }) {
  await page.locator(`[data-model-slug="${modelSlug}"]`).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(proof, "custom-model-identity.png"),
    mask: [page.locator("#provider-instance-claudeAgent-binaryPath")],
  });
}
async function files(dir) {
  try {
    const a = await fs.readdir(dir, { withFileTypes: true });
    return (
      await Promise.all(a.map((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : path.join(dir, e.name))))
    ).flat();
  } catch {
    return [];
  }
}
const lines = (s) => s.trim().split("\n").filter(Boolean).map(JSON.parse);
const hash = (s) => createHash("sha256").update(s).digest("hex");
export async function collect(config, proof, label = "disk") {
  const wire = lines(await fs.readFile(config.wire, "utf8").catch(() => ""));
  const wireUuids = new Set(
    wire
      .filter((e) => ["stdin", "stdout"].includes(e.kind))
      .map((e) => e.value.uuid)
      .filter(Boolean),
  );
  const indexFiles = await files(path.join(config.env.BRUV_CODING_AGENT_DIR, "native-sessions"));
  const nativeFiles = await files(path.join(config.env.CLAUDE_CONFIG_DIR, "projects"));
  const scope = path.dirname(config.state);
  const indexes = [];
  for (const file of indexFiles.filter((file) => file.endsWith(".json"))) {
    const evidence = await readSessionEvidence(file, nativeFiles, wireUuids, scope);
    if (evidence) indexes.push(evidence);
  }

  const counter = (await fs.readFile(path.join(config.state, "root-tool-count"), "utf8").catch(() => ""))
    .trim()
    .split("\n")
    .filter(Boolean).length;
  const out = {
    stage: label,
    indexes,
    completedRootToolExecutionCount: counter,
    actualToolUseCount: wire
      .filter((x) => x.kind === "stdout" && x.value.type === "assistant")
      .flatMap((x) => x.value.message?.content ?? [])
      .filter((b) => b.type === "tool_use").length,
  };
  // Redact only exported evidence. Hashes and source identities come from the
  // original files; projections never become live session/task authority.
  await writeEvidence(proof, "history-wire-projection", projectHistoryWire(wire), scope);
  await writeEvidence(proof, label, out, scope);
  return out;
}

async function readSessionEvidence(indexFile, nativeFiles, wireUuids, scope) {
  const index = JSON.parse(await fs.readFile(indexFile, "utf8"));
  if (!index.file) return;
  const raw = await fs.readFile(index.file, "utf8");
  const canonical = lines(raw);
  const nativeSessionId = path.basename(indexFile, ".json");
  const nativeFile = nativeFiles.find((file) => path.basename(file) === `${nativeSessionId}.jsonl`);
  const native = nativeFile ? lines(await fs.readFile(nativeFile, "utf8")) : [];
  return {
    nativeSessionId,
    canonicalSessionId: canonical[0]?.id,
    canonicalParentSession: canonical[0]?.parentSession ?? null,
    canonicalSha256: hash(raw),
    authorityOutputs: canonical
      .filter((e) => e.message?.role === "toolResult")
      .map((e) => JSON.stringify(e.message.content).replaceAll(scope, "<SCOPED>"))
      .filter((t) => t.includes("HISTORY_ROOT_AUTHORITY") || t.includes("HISTORY_AUTHORITY_INSPECTION")),
    canonicalEntries: canonical.map((e) => ({
      type: e.type,
      id: e.id,
      parentId: e.parentId,
      customType: e.customType,
      ...(e.type === "custom" && e.customType?.startsWith("bruv-native") ? { data: e.data } : {}),
      ...(e.message
        ? {
            role: e.message.role,
            toolCallId: e.message.toolCallId,
            contentMarkers: JSON.stringify(e.message.content ?? "").match(/HISTORY_[A-Z_]+|orchid-73/g),
            toolCalls: e.message.content
              ?.filter?.((b) => b.type === "toolCall")
              .map((b) => ({ id: b.id, name: b.name })),
          }
        : {}),
    })),
    mappings: reconcileNativeSources(canonical, native, wireUuids),
    nativeEntries: native.map((e) => ({
      type: e.type,
      uuid: e.uuid,
      parentUuid: e.parentUuid,
      sessionId: e.sessionId,
      bruv: e.bruv,
      forkedFrom: e.forkedFrom,
      markers: (JSON.stringify(e.message) ?? "").match(/HISTORY_[A-Z_]+|orchid-73/g),
    })),
  };
}

function reconcileNativeSources(canonical, native, wireUuids) {
  const sourceSessionId = canonical[0]?.id;
  const importedMap = canonical.filter((e) => e.customType === "bruv-native-entry-map").flatMap((e) => e.data.entries);
  return native
    .filter((e) => e.uuid && ["user", "assistant"].includes(e.type))
    .map((e) => {
      const mapped = importedMap.find((m) => m.nativeUuid === e.uuid);
      // A fork retains the old bruv provenance. Its canonical source belongs to
      // the fresh child and is resolved by the durable import map instead.
      const id = e.bruv?.sourceSessionId === sourceSessionId ? e.bruv.sourceMessageId : mapped?.piEntryId;
      const source = canonical.find((c) => c.id === id);
      return {
        nativeUuid: e.uuid,
        parentUuid: e.parentUuid,
        sourceSessionId,
        sourceEntryId: id,
        originalNativeSource: e.bruv,
        mappingKind: mapped ? "durable-import-map" : "direct-source-entry",
        sourceExists: !!source,
        sourceRole: source?.message?.role,
        nativeType: e.type,
        observedWireUuid: wireUuids.has(e.uuid),
      };
    });
}

function projectHistoryWire(wire) {
  return wire.map((x) => ({
    direction: x.kind,
    type: x.value.type,
    subtype: x.value.subtype,
    event: x.value.event,
    flags: x.value.flags,
    uuid: x.value.uuid,
    sessionId: x.value.session_id,
    control: x.value.request?.subtype,
    content: x.value.message?.content?.map?.((b) => ({
      type: b.type,
      id: b.id,
      toolUseId: b.tool_use_id,
      name: b.name,
      markers: JSON.stringify(b).match(/HISTORY_[A-Z_]+|orchid-73/g),
    })),
  }));
}

async function writeEvidence(proof, label, value, scope) {
  await fs.writeFile(
    path.join(proof, `${label}.json`),
    `${JSON.stringify(value, null, 2).replaceAll(scope, "<SCOPED>")}\n`,
  );
}
export async function exercise({ page, url, snapshot, body, config }) {
  const log = [];
  const action = async (name, fn) => {
    log.push({ action: name, status: "attempted" });
    await fs.writeFile(path.join(config.proof, "actions.json"), JSON.stringify(log, null, 2));
    await fn();
    log.at(-1).status = "completed";
    await fs.writeFile(path.join(config.proof, "actions.json"), JSON.stringify(log, null, 2));
  };
  await page.goto(url);
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  const message = page.getByRole("textbox", { name: "Message", exact: true });
  await message.waitFor();
  await page.locator('[data-chat-provider-model-picker="true"]').first().click();
  await page.getByText("Local deterministic acceptance (not Claude)", { exact: true }).last().click();
  const submit = async (text, reply) => {
    await message.fill(text);
    await page.getByRole("button", { name: "Submit message", exact: true }).click();
    await page.getByText(reply, { exact: false }).last().waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Submit message", exact: true }).waitFor({ timeout: 30000 });
  };
  await action("Submit HISTORY_SEED with secret orchid-73 and one real completed execute exchange", () =>
    submit("HISTORY_SEED: remember orchid-73; complete one real tool exchange.", "HISTORY_CHECKPOINT:"),
  );
  await page.locator("[data-thread-item]").filter({ hasText: "HISTORY_SEED" }).first().click();
  const rootUrl = page.url();
  await snapshot("root-checkpoint");
  await collect(config, config.proof, "root-checkpoint-disk");
  await action("Submit later root-only context", () =>
    submit("HISTORY_ROOT_FUTURE: only original branch sees this.", "HISTORY_ROOT_FUTURE_RESPONSE:"),
  );
  await action("Reload original thread and prove persisted rendered root history", async () => {
    await page.reload();
    await page.waitForTimeout(1000);
    await page.locator("[data-thread-item]").filter({ hasText: "HISTORY_SEED" }).first().click();
    await page.getByText("HISTORY_CHECKPOINT:", { exact: false }).last().waitFor();
    await page.getByText("HISTORY_ROOT_FUTURE_RESPONSE:", { exact: false }).last().waitFor();
  });
  await snapshot("root-persisted");
  const before = await collect(config, config.proof, "root-before-fork");
  await action("Click real first assistant checkpoint Fork from this response", async () => {
    const forks = page.getByRole("button", { name: "Fork from this response", exact: true });
    await forks.first().click();
    await page.waitForFunction((old) => location.href !== old, rootUrl, { timeout: 30000 });
  });
  await snapshot("fork-created");
  const fork = await collect(config, config.proof, "fork-before-continue");
  assert.equal(fork.completedRootToolExecutionCount, 1);
  assert.equal(fork.actualToolUseCount, before.actualToolUseCount, "UI fork executes no stored tool");
  await action("Continue fresh child with original context and actual authority inspection", () =>
    submit(
      "HISTORY_CHILD_CONTINUE: recall original checkpoint; inspect current jobs/questions without creating either.",
      "HISTORY_CHILD_CONTEXT_OK",
    ),
  );
  // Use the real persisted sidebar item, not a possibly still-transitioning
  // fork draft route. Navigating a draft directly creates a new conversation.
  await page.locator("[data-thread-item]").filter({ hasText: "HISTORY_CHILD_CONTINUE" }).first().click();
  await page.getByText("HISTORY_CHILD_CONTEXT_OK", { exact: false }).last().waitFor();
  await snapshot("child-continued");
  const child = await collect(config, config.proof, "child-continued-disk");
  assert.equal(child.completedRootToolExecutionCount, 1);
  await action("Reopen original branch unchanged", async () => {
    await page.goto(rootUrl);
    await page.getByText("HISTORY_ROOT_FUTURE_RESPONSE:", { exact: false }).last().waitFor();
    assert.ok(!(await body()).includes("HISTORY_CHILD_CONTEXT_OK"));
    const now = await collect(config, config.proof, "root-after-fork");
    const rootId = before.indexes.find((x) =>
      x.nativeEntries.some((e) => e.markers?.includes("HISTORY_ROOT_FUTURE_RESPONSE")),
    )?.nativeSessionId;
    assert.ok(rootId);
    assert.equal(
      now.indexes.find((x) => x.nativeSessionId === rootId)?.canonicalSha256,
      before.indexes.find((x) => x.nativeSessionId === rootId)?.canonicalSha256,
    );
  });
  await snapshot("old-branch-unchanged");
  await page.locator("[data-thread-item]").filter({ hasText: "HISTORY_CHILD_CONTINUE" }).first().click();
  await page.getByText("HISTORY_CHILD_CONTEXT_OK", { exact: false }).last().waitFor();
  await action("Add removable later child turn", () =>
    submit("HISTORY_CHILD_FUTURE: discard this later turn on rollback.", "HISTORY_CHILD_FUTURE_RESPONSE:"),
  );
  await snapshot("before-rollback");
  await action("Native Edit from here rollback at removable child user turn", async () => {
    const toastClose = page.locator('[data-slot="toast-close"]');
    if (await toastClose.first().isVisible()) await toastClose.first().click();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Edit from here", exact: true }).last().click();
    await page.getByRole("button", { name: "Revert and keep changes", exact: true }).click();
    await page.waitForTimeout(1500);
  });
  await snapshot("rollback-action");
  await action("Continue rolled-back branch", () =>
    submit("HISTORY_AFTER_ROLLBACK: use retained child checkpoint only.", "HISTORY_ROLLBACK_CONTEXT_OK"),
  );
  await snapshot("rollback-continued");
  await action("Reload/reopen child and continue correct rolled-back branch", async () => {
    await page.reload();
    await page.getByText("HISTORY_ROLLBACK_CONTEXT_OK", { exact: false }).last().waitFor();
    await submit("HISTORY_REOPEN: continue this same branch.", "HISTORY_REOPEN_CONTEXT_OK");
  });
  await snapshot("reopened");
}
export async function verify({ config, proof, t3Version, t3BinarySha256 }) {
  const disk = await collect(config, proof, "final-disk");
  assert.equal(disk.completedRootToolExecutionCount, 1);
  assert.equal(disk.indexes.length, 2);
  const before = JSON.parse(await fs.readFile(path.join(proof, "root-before-fork.json"), "utf8"));
  const root = before.indexes.find((i) =>
    i.nativeEntries.some((e) => e.markers?.includes("HISTORY_ROOT_FUTURE_RESPONSE")),
  );
  const original = disk.indexes.find((i) => i.nativeSessionId === root.nativeSessionId);
  const child = disk.indexes.find((i) => i.nativeSessionId !== root.nativeSessionId);
  assert.equal(original.canonicalSha256, root.canonicalSha256, "original branch remains byte-identical");
  assert.notEqual(child.canonicalSessionId, original.canonicalSessionId);
  assert.equal(child.canonicalParentSession, null, "fork is a fresh owner, not an owned child task");
  const active = [];
  let entry = child.nativeEntries.findLast((e) => e.type === "assistant");
  while (entry) {
    active.unshift(entry);
    entry = child.nativeEntries.find((e) => e.uuid === entry.parentUuid);
  }
  const markers = active.flatMap((e) => e.markers ?? []);
  for (const marker of [
    "HISTORY_CHECKPOINT",
    "HISTORY_CHILD_CONTEXT_OK",
    "HISTORY_ROLLBACK_CONTEXT_OK",
    "HISTORY_REOPEN_CONTEXT_OK",
  ])
    assert.ok(markers.includes(marker), `active native branch retains ${marker}`);
  for (const marker of ["HISTORY_ROOT_FUTURE", "HISTORY_CHILD_FUTURE"])
    assert.ok(!markers.includes(marker), `active native branch excludes ${marker}`);
  for (const index of disk.indexes) {
    const calls = index.canonicalEntries.flatMap((e) => e.toolCalls ?? []);
    assert.equal(calls.length, index === original ? 1 : 2, "only root exchange and fresh child inspection");
    for (const call of calls) {
      assert.equal(call.name, "execute");
      assert.equal(index.canonicalEntries.filter((e) => e.role === "toolResult" && e.toolCallId === call.id).length, 1);
    }
  }
  const imported = child.nativeEntries.filter((e) => e.forkedFrom);
  assert.equal(imported.length, 4, "complete seed/tool-use/tool-result/checkpoint imported");
  for (const entry of imported) {
    assert.notEqual(entry.uuid, entry.forkedFrom.messageUuid);
    assert.equal(entry.forkedFrom.sessionId, original.nativeSessionId);
    assert.ok(original.nativeEntries.some((e) => e.uuid === entry.forkedFrom.messageUuid));
  }
  for (const index of disk.indexes)
    for (const m of index.mappings) {
      assert.ok(m.sourceExists, "canonical source mapping exists");
      assert.equal(m.sourceSessionId, index.canonicalSessionId);
    }
  await fs.writeFile(
    path.join(proof, "result.json"),
    `${JSON.stringify(
      {
        integratedAcceptance: true,
        historyAcceptance: true,
        passed: true,
        t3Version,
        t3BinarySha256,
        upstreamUnmodified: true,
        syntheticConnectorEvents: false,
        realCredentialsUsed: false,
      },
      null,
      2,
    )}\n`,
  );
}
