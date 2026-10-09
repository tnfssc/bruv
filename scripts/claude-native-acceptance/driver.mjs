import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { modelSlug } from "./model.mjs";
export async function prepare({ base, fixture, config }) {
  if ((config.questionCases || config.permissionCases) && !config.humanControls)
    throw Error(
      "Human bindings are not available in this slice. Do not fabricate permission/question native events; extend driver when parent binds them.",
    );
  const dir = path.join(base, "userdata");
  await fs.mkdir(dir, { recursive: true });
  if (config.humanControls)
    await fs.writeFile(
      path.join(dir, "keybindings.json"),
      JSON.stringify([{ key: "ctrl+escape", command: "thread.stop" }]),
    );
  await fs.writeFile(
    path.join(dir, "settings.json"),
    JSON.stringify(
      {
        providerInstances: {
          claudeAgent: {
            driver: "claudeAgent",
            enabled: true,
            displayName: "Bruv local deterministic acceptance (not Claude)",
            config: {
              binaryPath: fixture,
              homePath: config.env.CLAUDE_CONFIG_DIR,
              customModels: [
                {
                  slug: modelSlug,
                  name: "Local deterministic acceptance (not Claude)",
                  capabilities: { optionDescriptors: [] },
                },
              ],
            },
          },
        },
      },
      null,
      2,
    ),
  );
}
async function waitForFile(file, limit = 15000) {
  const until = Date.now() + limit;
  while (Date.now() < until) {
    try {
      await fs.access(file);
      return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error(`Actual managed worker did not produce ${path.basename(file)}`);
}
export async function captureIdentity({ page, proof }) {
  const row = page.locator(`[data-model-slug="${modelSlug}"]`);
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(proof, "custom-model-identity.png") });
}
export async function exercise({ page, url, snapshot, body, config, observation }) {
  if (config.humanControls) return (await import("./human-driver.mjs")).exercise({ page, url, snapshot, body, config });
  const state = config.state;
  // Reuse the real native composer prepared by the shared harness.
  const message = page.getByRole("textbox", { name: "Message", exact: true });
  await message.waitFor();
  // Use T3's own customModels selector. Never submit under an Opus/Sonnet alias.
  const picker = page.locator('[data-chat-provider-model-picker="true"]').first();
  await picker.click();
  await page.getByText("Local deterministic acceptance (not Claude)", { exact: true }).last().click();
  await snapshot("model-identity");
  const submit = async (text) => {
    await message.fill(text);
    await page.getByRole("button", { name: "Submit message", exact: true }).click();
  };
  const visible = async (text) => {
    await page.getByText(text, { exact: false }).last().waitFor({ timeout: 30000 });
  };
  await submit("ACCEPT_EXECUTE: run the actual Bruv execute tool.");
  await visible("EXECUTE_CONFIRMED_REAL");
  await snapshot("execute");
  await submit("ACCEPT_STEER: start a real managed shell and wait for it.");
  await waitForFile(path.join(state, "steer.started"));
  await snapshot("active-tool");
  await message.fill("ACCEPT_STEER_NOW: acknowledge this admitted steer.");
  await page.getByRole("button", { name: "Queue message", exact: true }).click();
  await page.getByRole("button", { name: "Steer", exact: true }).click();
  await snapshot("steer-during-tool");
  await fs.writeFile(path.join(state, "steer.release"), "release");
  await visible("STEER_ADMITTED_REAL");
  await waitForFile(path.join(state, "steer.finished"));
  await snapshot("steered");
  await submit("ACCEPT_EARLY_RETURN: start a managed shell with waitSeconds zero.");
  await waitForFile(path.join(state, "early.started"));
  await visible("EARLY_RETURN_REAL");
  await snapshot("early-return");
  await fs.writeFile(path.join(state, "early.release"), "release");
  await waitForFile(path.join(state, "early.finished"));
  // Completion must wake the actual model through Bruv/T3, not a fixture timer packet.
  await visible("TASK_COMPLETED_REAL");
  await snapshot("task-completed");
  await submit("ACCEPT_STOP: wait on another actual managed shell.");
  await waitForFile(path.join(state, "stop.started"));
  await snapshot("before-stop");
  await page.getByRole("button", { name: "Stop generation", exact: true }).click();
  await visible("Run interrupted by user");
  await waitForProcessExit(path.join(state, "stop.started"));
  assert.equal(
    await fs.access(path.join(state, "stop.finished")).then(
      () => true,
      () => false,
    ),
    false,
    "Stop killed the gated shell before normal completion",
  );
  await snapshot("stopped");
  await page.reload();
  await page.getByRole("textbox", { name: "Message", exact: true }).waitFor();
  await page.locator("[data-thread-item]").filter({ hasText: "ACCEPT_EXECUTE" }).first().click();
  await visible("Run interrupted by user");
  await snapshot("reloaded");
  // Native Stop closes the connector and its owned tasks. The new owner must
  // launch and cancel its own job, not claim the old process survived.
  await submit("ACCEPT_CANCEL: launch a fresh managed shell, cancel it, and inspect confirmed exit.");
  await visible("CANCELLATION_COMPLETED_REAL");
  await snapshot("cancellation-final");
  // T3 folds intermediate assistant replies when an automatic continuation
  // supplies the final answer. Prove the original acknowledgement is retained.
  if (!(await page.getByText("CANCEL_CONFIRMED_REAL").last().isVisible()))
    await expandRunDisclosure(page, observation.cancellationRunId);
  await snapshot("cancellation-expanded");
  await visible("CANCEL_CONFIRMED_REAL");
  await snapshot("task-cancelled");
  assertCancellationChronology(
    await renderedTimelineText(page, path.join(config.proof, "cancellation-visual-chronology.json")),
  );
  await page.goto(`${url}/settings/providers`);
  await page.goto(url);
  await page.locator("[data-thread-item]").filter({ hasText: "ACCEPT_EXECUTE" }).first().click();
  await visible("CANCELLATION_COMPLETED_REAL");
  if (!(await page.getByText("CANCEL_CONFIRMED_REAL").last().isVisible()))
    await expandRunDisclosure(page, observation.cancellationRunId);
  await visible("CANCEL_CONFIRMED_REAL");
  await snapshot("reopened");
  assertCancellationChronology(
    await renderedTimelineText(page, path.join(config.proof, "reopened-visual-chronology.json")),
  );
  await submit("ACCEPT_REOPEN: confirm the real session can continue after reopen.");
  await visible("REOPEN_CONFIRMED_REAL");
  await snapshot("continued");
}
export function checkWire(wire) {
  const incoming = wire.filter((x) => x.kind === "stdin").map((x) => x.value),
    out = wire.filter((x) => x.kind === "stdout").map((x) => x.value);
  assert.ok(
    incoming.some((m) => m.type === "user" && m.priority === "now"),
    "T3 native priority=now steering admission",
  );
  assert.ok(
    incoming.some((m) => m.type === "control_request" && m.request?.subtype === "interrupt"),
    "native Stop interrupt",
  );
  const blocks = out.flatMap((m) => (Array.isArray(m.message?.content) ? m.message.content : []));
  const toolCalls = blocks.filter((c) => c.type === "tool_use"),
    toolResults = blocks.filter((c) => c.type === "tool_result");
  assert.ok(
    toolCalls.some((t) => t.name === "execute"),
    "actual connector execute tool projection",
  );
  const actualToolResults = JSON.stringify(toolResults);
  for (const marker of ["BRUV_EXECUTE_REAL", "CANCEL_INSPECT_REAL"])
    assert.ok(actualToolResults.includes(marker), `Actual tool_result ${marker}`);
  assert.match(actualToolResults, /task_/, "Real tool_result managed task ID");
  const assistantText = (m) =>
    m.type === "assistant" && Array.isArray(m.message?.content)
      ? m.message.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("")
      : "";
  for (const marker of ["EARLY_RETURN_REAL", "TASK_COMPLETED_REAL", "CANCELLATION_COMPLETED_REAL"])
    assert.ok(
      out.some((m) => assistantText(m).includes(marker)),
      `Actual assistant output ${marker}`,
    );
  const taskStarts = out.filter((m) => m.type === "system" && m.subtype === "task_started");
  const taskEnds = out.filter((m) => m.type === "system" && m.subtype === "task_notification");
  assert.ok(taskStarts.length >= 3, "Actual managed shell task_started lifecycle");
  assert.ok(
    taskEnds.some((m) => m.status === "completed"),
    "Actual managed shell completion",
  );
  assert.ok(
    taskEnds.some((m) => m.status === "stopped"),
    "Explicit jobs.stop native stopped lifecycle",
  );
  for (const end of taskEnds)
    assert.ok(
      taskStarts.some((s) => s.task_id === end.task_id),
      "terminal task event matches actual started task",
    );
  const stopIndex = wire.findIndex(
    (x) => x.kind === "stdin" && x.value?.type === "control_request" && x.value.request?.subtype === "interrupt",
  );
  assert.ok(
    wire.slice(stopIndex + 1).some((x) => x.kind === "lifecycle" && x.value?.event === "exit"),
    "Stop closes actual query process after interrupt",
  );
  return {
    taskStarts: taskStarts.length,
    taskEnds: taskEnds.length,
    executeCalls: toolCalls.filter((t) => t.name === "execute").length,
  };
}
export function projectWire(wire) {
  return wire.map((x) => {
    const m = x.value;
    if (x.kind === "lifecycle")
      return { direction: x.kind, event: m.event, code: m.code, signal: m.signal, flags: m.flags };
    if (x.kind === "diagnostic") return { direction: x.kind, error: m.error };
    return {
      direction: x.kind,
      frameIdHash:
        typeof m.uuid === "string" ? createHash("sha256").update(m.uuid).digest("hex").slice(0, 16) : undefined,
      userMessageUuidHash:
        typeof m.user_message_uuid === "string"
          ? createHash("sha256").update(m.user_message_uuid).digest("hex").slice(0, 16)
          : undefined,
      userMessageUuidHashes: Array.isArray(m.user_message_uuids)
        ? m.user_message_uuids.map((id) => createHash("sha256").update(id).digest("hex").slice(0, 16))
        : undefined,
      messageIdHash:
        typeof m.message?.id === "string"
          ? createHash("sha256").update(m.message.id).digest("hex").slice(0, 16)
          : undefined,
      streamMessageIdHash:
        typeof m.event?.message?.id === "string"
          ? createHash("sha256").update(m.event.message.id).digest("hex").slice(0, 16)
          : undefined,
      eventType: m.event?.type,
      originKind: m.origin?.kind,
      fixtureMarkers: [
        "EXECUTE_CONFIRMED_REAL",
        "STEER_ADMITTED_REAL",
        "CANCEL_CONFIRMED_REAL",
        "CANCELLATION_COMPLETED_REAL",
      ].filter(
        (marker) =>
          Array.isArray(m.message?.content) &&
          m.message.content.some((p) => p.type === "text" && typeof p.text === "string" && p.text.includes(marker)),
      ),
      type: m.type,
      subtype: m.subtype,
      control: m.request?.subtype,
      priority: m.priority,
      status: m.status,
      toolNames: Array.isArray(m.message?.content)
        ? m.message.content.filter((c) => c.type === "tool_use").map((c) => c.name)
        : undefined,
    };
  });
}
export async function verify({ wire, config, proof, t3Version, t3BinarySha256 }) {
  if (config.humanControls)
    return (await import("./human-driver.mjs")).verify({ wire, config, proof, t3Version, t3BinarySha256 });
  const lifecycle = checkWire(wire);
  const projection = projectWire(wire);
  await fs.writeFile(
    path.join(proof, "wire-projection.ndjson"),
    `${projection.map((x) => JSON.stringify(x)).join("\n")}\n`,
  );
  await fs.writeFile(
    path.join(proof, "result.json"),
    `${JSON.stringify(
      {
        integratedAcceptance: true,
        syntheticConnectorEvents: false,
        modelIdentity: modelSlug,
        testModelNotClaude: true,
        realCredentialsUsed: false,
        t3Version,
        t3BinarySha256,
        upstreamUnmodified: true,
        actualChecks: [
          "execute",
          "managed shell",
          "steer during tool",
          "early-return",
          "completion wake",
          "generation Stop",
          "explicit job cancellation",
          "reload",
          "reopen",
          "continued session",
        ],
        ...lifecycle,
        gaps: [
          "normal subagent profile inheritance not tested",
          "permission binding not present in this slice",
          "saved-question binding not present in this slice",
          "restart/fork/storage parity belongs to parent acceptance",
        ],
      },
      null,
      2,
    )}\n`,
  );
}

/** Native Stop owns the connector subtree; transcript text alone is not exit proof. */
export async function waitForProcessExit(pidFile, timeoutMs = 15000) {
  const pid = Number((await fs.readFile(pidFile, "utf8")).trim());
  assert.ok(Number.isInteger(pid) && pid > 1, "Actual fixture process identity");
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    if (Date.now() >= deadline) throw Error(`Native Stop left fixture process alive: ${pid}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// Passive inspection of actual T3 projections, not synthetic connector output.
const fixtureMarkers = [
  "EXECUTE_CONFIRMED_REAL",
  "STEER_ADMITTED_REAL",
  "EARLY_RETURN_REAL",
  "TASK_COMPLETED_REAL",
  "CANCEL_CONFIRMED_REAL",
  "CANCELLATION_COMPLETED_REAL",
  "REOPEN_CONFIRMED_REAL",
  "ACCEPT_EXECUTE",
  "ACCEPT_CANCEL",
];
const idHash = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
export function capture({ page }) {
  const t3Items = [];
  let cancellationRunId;
  let sequence = 0;
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      let decoded;
      try {
        decoded = JSON.parse(typeof payload === "string" ? payload : Buffer.from(payload).toString("utf8"));
      } catch {
        return;
      }
      const walk = (value, owner = {}, location = "root") => {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) {
          for (const [index, entry] of value.entries()) walk(entry, owner, `${location}[${index}]`);
          return;
        }
        if (value.type === "user_message" && value.text?.startsWith("ACCEPT_CANCEL:")) cancellationRunId = value.runId;
        const context = { ...owner };
        for (const key of [
          "id",
          "itemId",
          "turnId",
          "threadId",
          "nativeItemId",
          "providerTurnId",
          "messageId",
          "runId",
          "nodeId",
          "rootNodeId",
          "parentNodeId",
          "nativeId",
        ])
          if (typeof value[key] === "string") context[`${key}Hash`] = idHash(value[key]);
        const markers = fixtureMarkers.filter((marker) =>
          Object.values(value).some((text) => typeof text === "string" && text.includes(marker)),
        );
        if (markers.length) {
          t3Items.push({
            sequence: sequence++,
            location,
            ...context,
            markers,
            createdAt: value.createdAt,
            updatedAt: value.updatedAt,
            ordinal: value.ordinal,
            role: value.role,
            type: typeof value.type === "string" ? value.type : undefined,
            kind: typeof value.kind === "string" ? value.kind : undefined,
            status: typeof value.status === "string" ? value.status : undefined,
          });
        }
        for (const [key, child] of Object.entries(value))
          if (typeof child === "object") walk(child, context, `${location}.${key}`);
      };
      walk(decoded);
    }),
  );
  return {
    get cancellationRunId() {
      return cancellationRunId;
    },
    flush: (destination) => persistT3Evidence(destination, t3Items),
  };
}
// The shared replay finalizes through the integration driver even if browser setup failed
// before capture. In that case there are no live items, but persisted evidence still exists.
export async function flushCapture({ proof, root, observation }) {
  if (observation) await observation.flush({ proof, root });
  else await persistT3Evidence({ proof, root }, []);
}
async function persistT3Evidence({ proof, root }, t3Items) {
  if (root) {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(path.join(root, "t3-base/userdata/statev2.sqlite"), { readOnly: true });
    try {
      const rows = database
        .prepare("SELECT ordinal,type,payload_json FROM orchestration_v2_projection_turn_items ORDER BY ordinal")
        .all();
      const projection = rows.map((row) => {
        const item = JSON.parse(row.payload_json);
        return {
          ordinal: row.ordinal,
          type: row.type,
          idHash: idHash(item.id),
          messageIdHash: item.messageId ? idHash(item.messageId) : undefined,
          runIdHash: idHash(item.runId),
          markers: fixtureMarkers.filter((marker) => item.text?.includes(marker)),
        };
      });
      await fs.writeFile(path.join(proof, "t3-persisted-item-projection.json"), JSON.stringify(projection, null, 2));
    } finally {
      database.close();
    }
  }
  await fs.writeFile(path.join(proof, "t3-item-projection.json"), `${JSON.stringify(t3Items, null, 2)}\n`);
}

export function assertCancellationChronology(body) {
  const request = body.indexOf("ACCEPT_CANCEL:");
  const acknowledgement = body.indexOf("CANCEL_CONFIRMED_REAL");
  const completion = body.indexOf("CANCELLATION_COMPLETED_REAL");
  assert.ok(request >= 0 && acknowledgement > request, "Cancellation acknowledgement follows its human request");
  assert.ok(completion > acknowledgement, "Killed-job completion follows the retained cancellation acknowledgement");
}

export async function captureFailure({ page, proof, root }) {
  const collect = async () => {
    const rows = await page.getByRole("button", { name: /^Worked for / }).evaluateAll((elements) =>
      elements.map((element, index) => ({
        index,
        text: element.textContent,
        expanded: element.getAttribute("aria-expanded"),
        top: element.getBoundingClientRect().top,
        rowId: element.closest("[data-timeline-row-id]")?.getAttribute("data-timeline-row-id"),
      })),
    );
    return rows.map(({ rowId, ...row }) => ({
      ...row,
      runIdHash: rowId?.startsWith("turn-fold:") ? idHash(rowId.slice("turn-fold:".length)) : undefined,
    }));
  };
  await fs.writeFile(path.join(proof, "diagnostic-disclosures.json"), JSON.stringify(await collect(), null, 2));
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(path.join(root, "t3-base/userdata/statev2.sqlite"), { readOnly: true });
  let request;
  try {
    request = database
      .prepare(
        "SELECT payload_json FROM orchestration_v2_projection_turn_items WHERE type='user_message' AND payload_json LIKE '%ACCEPT_CANCEL:%'",
      )
      .all()
      .map((row) => JSON.parse(row.payload_json))[0];
  } finally {
    database.close();
  }
  if (!request) return;
  const disclosure = () =>
    page.locator(`[data-timeline-row-id="turn-fold:${request.runId}"]`).getByRole("button", { name: /^Worked for / });
  const retain = async (name) => {
    const button = disclosure();
    if ((await button.getAttribute("aria-expanded")) === "false") await button.click();
    await page.getByText("CANCEL_CONFIRMED_REAL").last().waitFor();
    await fs.writeFile(
      path.join(proof, `${name}.txt`),
      (await page.locator("body").innerText()).replace(/\/var\/tmp\/bruv-native-acceptance-[^/]+/g, "<FIXTURE>"),
    );
    await page.screenshot({ path: path.join(proof, `${name}.png`) });
  };
  await retain("diagnostic-correct-disclosure");
  await fs.writeFile(path.join(proof, "diagnostic-correct-disclosures.json"), JSON.stringify(await collect(), null, 2));
  await page.reload();
  await page.getByRole("textbox", { name: "Message", exact: true }).waitFor();
  await page.locator("[data-thread-item]").filter({ hasText: "ACCEPT_EXECUTE" }).first().click();
  await page.getByText("CANCELLATION_COMPLETED_REAL").last().waitFor();
  await retain("diagnostic-reloaded-correct-disclosure");
}

// LegendList recycles DOM slots. DOM .last() and body.innerText order are not
// chronological; use the actual T3 run identity and the rendered row positions.
export async function expandRunDisclosure(page, runId) {
  assert.ok(runId, "Actual cancellation run identity must be observed");
  const button = page
    .locator(`[data-timeline-row-id="turn-fold:${runId}"]`)
    .getByRole("button", { name: /^Worked for / });
  if ((await button.getAttribute("aria-expanded")) === "false") await button.click();
  assert.equal(await button.getAttribute("aria-expanded"), "true", "The cancellation run disclosure is expanded");
}
export function timelineTextInVisualOrder(rows) {
  return [...rows]
    .sort((a, b) => a.top - b.top)
    .map((row) => row.text)
    .join("\n");
}
export async function renderedTimelineText(page, outputPath) {
  const rows = await page.locator('[data-timeline-row-kind="message"]').evaluateAll((elements) =>
    elements.map((element) => ({
      id: element.getAttribute("data-timeline-row-id"),
      top: element.getBoundingClientRect().top,
      text: element.innerText,
    })),
  );
  if (outputPath)
    await fs.writeFile(
      outputPath,
      JSON.stringify(
        rows.map((row) => ({
          idHash: idHash(row.id),
          top: row.top,
          markers: fixtureMarkers.filter((marker) => row.text.includes(marker)),
        })),
        null,
        2,
      ),
    );
  return timelineTextInVisualOrder(rows);
}
