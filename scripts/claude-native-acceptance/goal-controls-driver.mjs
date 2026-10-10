import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { budgetObjective, objective } from "./goal-controls-model.mjs";
import { modelSlug } from "./model.mjs";

export { captureIdentity, prepare } from "./driver.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 16);
const content = (value) =>
  typeof value === "string" ? value : Array.isArray(value) ? value.map((block) => block.text ?? "").join("\n") : "";
async function poll(read, predicate, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Error(`Timed out: ${label}`);
}
async function wire(config) {
  try {
    return (await fs.readFile(config.wire, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
  } catch {
    return [];
  }
}
async function goal(config) {
  const files = await fs.readdir(config.env.BRUV_CODING_AGENT_DIR, { recursive: true });
  const entries = [];
  for (const file of files.filter((name) => name.endsWith(".jsonl"))) {
    const rows = (await fs.readFile(path.join(config.env.BRUV_CODING_AGENT_DIR, file), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
    entries.push(...rows.filter((entry) => entry.type === "custom" && entry.customType === "bruv-goal"));
  }
  entries.sort((a, b) => a.data.at.localeCompare(b.data.at));
  const last = entries.at(-1)?.data;
  return last?.operation === "clear" ? null : last?.goal;
}
const projectedGoal = (current) =>
  current && {
    idHash: hash(current.id),
    objective: current.objective,
    status: current.status,
    revision: current.revision,
    tokensUsed: current.tokensUsed,
    tokenBudget: current.tokenBudget,
  };

export async function exercise({ page, snapshot: nativeSnapshot, config }) {
  const evidence = { checks: [], states: [], commands: [] };
  const save = () =>
    fs.writeFile(path.join(config.proof, "goal-controls-observations.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  const snapshot = async (name) => {
    evidence.states.push({ step: name, goal: projectedGoal(await goal(config)) });
    await save();
    await nativeSnapshot(name);
    const file = path.join(config.proof, `${name}.txt`);
    await fs.writeFile(file, (await fs.readFile(file, "utf8")).replaceAll(path.dirname(config.state), "<FIXTURE>"));
  };
  const message = page.getByRole("textbox", { name: "Message", exact: true });
  const idle = async () => {
    await page
      .getByRole("button", { name: "Stop generation", exact: true })
      .waitFor({ state: "hidden", timeout: 30000 });
    await page.getByText("Working", { exact: true }).waitFor({ state: "hidden", timeout: 30000 });
    await message.waitFor();
    assert.equal(await message.isEditable(), true);
    // After native Stop, T3 hides Submit until the empty composer has content.
    // submit() verifies the actual enabled button after filling that content.
  };
  const submit = async (value, active = false) => {
    const before = (await wire(config)).length;
    await message.fill(value);
    await page.getByRole("button", { name: active ? "Queue message" : "Submit message", exact: true }).click();
    if (active) {
      const steer = page.getByRole("button", { name: "Steer", exact: true });
      const admission = await poll(
        async () => ({ rows: await wire(config), queued: await steer.isVisible() }),
        ({ rows, queued }) =>
          queued ||
          rows
            .slice(before)
            .some(
              (row) =>
                row.kind === "stdin" && row.value.type === "user" && content(row.value.message?.content) === value,
            ),
        `native queue or immediate admission ${value}`,
      );
      if (admission.queued) await steer.click();
    }
    const rows = await poll(
      () => wire(config),
      (rows) =>
        rows
          .slice(before)
          .some(
            (row) => row.kind === "stdin" && row.value.type === "user" && content(row.value.message?.content) === value,
          ),
      `actual native input ${value}`,
    );
    const input = rows
      .slice(before)
      .find(
        (row) => row.kind === "stdin" && row.value.type === "user" && content(row.value.message?.content) === value,
      ).value;
    return { uuid: input.uuid, priority: input.priority, before };
  };
  const command = async (value, active = false) => {
    const previousMessages = await page.getByText(value, { exact: true }).count();
    const { uuid, priority, before } = await submit(value, active);
    const rows = await poll(
      () => wire(config),
      (rows) =>
        uuid
          ? rows.some(
              (row) =>
                row.kind === "stdout" &&
                row.value.type === "command_lifecycle" &&
                row.value.command_uuid === uuid &&
                row.value.state === "completed",
            )
          : rows
              .slice(before)
              .some(
                (row) =>
                  row.kind === "stdout" && row.value.type === "assistant" && row.value.message?.model === "<synthetic>",
              ),
      `command completed ${value}`,
    );
    const outputs = rows.filter((row) => row.kind === "stdout").map((row) => row.value);
    if (uuid)
      assert.deepEqual(
        outputs
          .filter((frame) => frame.type === "command_lifecycle" && frame.command_uuid === uuid)
          .map((frame) => frame.state),
        ["started", "completed"],
      );
    if (active) {
      const controlOutputs = rows
        .slice(before)
        .filter((row) => row.kind === "stdout")
        .map((row) => row.value);
      assert.equal(
        controlOutputs.some(
          (frame) => frame.type === "result" || (frame.subtype === "session_state_changed" && frame.state === "idle"),
        ),
        false,
        "Active command must not complete or take ownership of the foreground result",
      );
      assert.equal(
        controlOutputs.filter((frame) => frame.type === "user" && content(frame.message?.content) === value).length,
        1,
        "Native command is echoed once",
      );
      await page.getByRole("button", { name: "Stop generation", exact: true }).waitFor();
    } else await idle();
    await page.getByRole("button", { name: "Steer", exact: true }).waitFor({ state: "hidden" });
    await poll(
      () => page.getByText(value, { exact: true }).count(),
      (count) => count === previousMessages + 1,
      "one additional rendered control message",
    );
    evidence.commands.push({
      value,
      active,
      uuidHash: uuid ? hash(uuid) : undefined,
      priority,
      isolatedLifecycle: Boolean(uuid),
      anonymousSteering: !uuid,
    });
    await save();
    return uuid;
  };
  const nativeClear = async () => {
    const before = (await wire(config)).length;
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    const rows = await poll(
      () => wire(config),
      (rows) =>
        rows
          .slice(before)
          .some(
            (row) =>
              row.kind === "stdin" &&
              row.value.type === "user" &&
              content(row.value.message?.content) === "/goal clear",
          ),
      "native goal Clear action reaches connector",
    );
    const input = rows
      .slice(before)
      .find(
        (row) =>
          row.kind === "stdin" && row.value.type === "user" && content(row.value.message?.content) === "/goal clear",
      ).value;
    await poll(
      () => goal(config),
      (current) => current === null,
      "native Clear removes persistent goal",
    );
    await idle();
    await page.getByText("Goal complete", { exact: true }).waitFor({ state: "hidden" });
    evidence.commands.push({
      value: "/goal clear",
      active: false,
      nativeAction: "Clear",
      uuidHash: input.uuid ? hash(input.uuid) : undefined,
    });
    await save();
  };
  const started = (name) =>
    poll(
      () =>
        fs.access(path.join(config.state, name)).then(
          () => true,
          () => false,
        ),
      Boolean,
      name,
    );
  const state = (status) =>
    poll(
      () => goal(config),
      (current) => current?.status === status,
      `goal ${status}`,
    );

  await message.waitFor();
  await page.locator('[data-chat-provider-model-picker="true"]').first().click();
  await page.getByText("Local deterministic acceptance (not Claude)", { exact: true }).last().click();
  await submit(`/goal ${objective}`);
  await started("goal-2.started");
  await poll(
    () => wire(config),
    (rows) =>
      rows.some(
        (row) =>
          row.kind === "stdout" &&
          row.value.type === "stream_event" &&
          row.value.event?.delta?.text?.trim() === "GOAL_SECOND_PENDING_REAL",
      ),
    "actual second automatic response is streaming",
  );
  await state("active");
  assert.equal((await goal(config)).tokenBudget, undefined, "An ordinary goal has no implicit token budget");
  const duringGoal = await wire(config);
  const unfinished = duringGoal.findIndex(
    (row) =>
      row.kind === "stdout" &&
      row.value.type === "assistant" &&
      content(row.value.message?.content) === "GOAL_FIRST_UNFINISHED_REAL",
  );
  assert.ok(unfinished >= 0, "First automatic iteration produced actual assistant output");
  assert.equal(
    duringGoal.slice(unfinished + 1).some((row) => row.kind === "stdout" && row.value.type === "result"),
    false,
    "An unfinished goal iteration must not finalize the native host turn",
  );
  await snapshot("goal-between-unfinished-turns");
  await page.getByText("Pursuing goal", { exact: true }).waitFor({ timeout: 10000 });
  assert.equal(
    await page.getByText("Goal complete", { exact: true }).isVisible(),
    false,
    "An unfinished assistant turn must not complete the native goal pill",
  );
  evidence.checks.push("Native goal remains active between unfinished automatic turns");

  for (const value of [
    "/bruv goal status",
    "/bruv status",
    "/bruv resources",
    "/mode fast",
    "/questions list",
    "/bruv live status",
    "/bruv live capabilities",
    "/bruv nope",
    "/bruv goal clear extra",
  ])
    await command(value, true);
  assert.equal((await goal(config)).objective, objective);
  assert.equal((await goal(config)).status, "active");
  await snapshot("active-controls-preserve-goal");
  await submit("/bruv goal pause", true);
  await state("paused");
  await idle();
  await snapshot("goal-paused");
  const paused = await goal(config);
  await page.reload();
  await page
    .locator("[data-thread-item]")
    .filter({ hasText: `/goal ${objective}` })
    .first()
    .click({ timeout: 30000 });
  await message.waitFor({ timeout: 30000 });
  await idle();
  assert.deepEqual(await goal(config), paused, "Reload must not resume or charge a paused goal");
  await page.getByText("Goal set", { exact: true }).waitFor();
  assert.equal(await page.getByText("Goal complete", { exact: true }).isVisible(), false);
  await snapshot("goal-paused-reloaded");
  await submit("/goal resume");
  await started("goal-3.started");
  assert.equal((await goal(config)).objective, objective);
  await page.getByRole("button", { name: "Stop generation", exact: true }).click();
  await state("paused");
  await idle();
  assert.equal((await goal(config)).objective, objective, "Native Stop preserves the persistent objective");
  await snapshot("goal-native-stopped");
  await submit("/goal resume");
  await started("goal-4.started");
  await fs.writeFile(path.join(config.state, "complete.release"), "release actual local model");
  await state("completed");
  await page.getByText("GOAL_COMPLETED_REAL", { exact: false }).last().waitFor();
  await idle();
  await page.getByText("Goal complete", { exact: true }).waitFor();
  await snapshot("goal-completed");
  evidence.checks.push(
    "Explicit pause, reload and native Stop preserve objective; resume and real execute complete native goal",
  );
  await nativeClear();
  assert.equal(await goal(config), null);
  await page.getByText("Goal complete", { exact: true }).waitFor({ state: "hidden" });

  await submit(`/goal ${budgetObjective} --tokens 23`);
  await state("budget_exceeded");
  await idle();
  assert.equal(
    await fs.access(path.join(config.state, "budget-forbidden.effect")).then(
      () => true,
      () => false,
    ),
    false,
    "Explicit response budget prevents the requested tool side effect",
  );
  assert.equal((await goal(config)).tokensUsed, 23);
  await snapshot("goal-budget-stopped");
  await command("/goal resume");
  assert.equal((await goal(config)).status, "budget_exceeded");
  await page.getByText("Goal token budget is exhausted", { exact: false }).last().waitFor();
  await command("/goal budget 100");
  await state("paused");
  await submit("/goal resume");
  await state("completed");
  await page.getByText("GOAL_BUDGET_COMPLETED_REAL", { exact: false }).last().waitFor();
  await idle();
  const completed = await goal(config);
  await submit("NATIVE_GOAL_POST_COMPLETION");
  await page.getByText("GOAL_POST_COMPLETION_REAL", { exact: false }).last().waitFor();
  await idle();
  assert.deepEqual(await goal(config), completed, "Completed goal usage is frozen on unrelated user work");
  await snapshot("goal-budget-completed-frozen");
  await nativeClear();
  assert.equal(await goal(config), null);
  evidence.checks.push(
    "Budget stop precedes tools; exhausted resume stays idle; user budget change enables completion; completed usage freezes",
  );
  evidence.modelSlug = modelSlug;
  await save();
}

export async function verify({ wire, config, proof, t3Version, t3BinarySha256 }) {
  const inputs = wire.filter((row) => row.kind === "stdin" && row.value.type === "user").map((row) => row.value);
  for (const prefix of [
    `/goal ${objective}`,
    "/bruv goal pause",
    "/goal resume",
    "/goal clear",
    `/goal ${budgetObjective}`,
  ])
    assert.ok(
      inputs.some((input) => content(input.message?.content).startsWith(prefix)),
      `Actual native goal control ${prefix}`,
    );
  // T3 may immediately admit a command at an automatic-turn boundary. Both
  // paths above use its real composer; only an actually queued input is steered.
  assert.ok(
    wire.some(
      (row) =>
        row.kind === "stdin" && row.value.type === "control_request" && row.value.request?.subtype === "interrupt",
    ),
    "Native Stop sent the actual interrupt control",
  );
  const observations = JSON.parse(await fs.readFile(path.join(proof, "goal-controls-observations.json"), "utf8"));
  assert.equal(observations.checks.length, 3);
  assert.equal(await goal(config), null);
  await fs.writeFile(
    path.join(proof, "result.json"),
    `${JSON.stringify(
      {
        nativeGoalControls: true,
        passed: true,
        t3Version,
        t3BinarySha256,
        checks: observations.checks,
        realCredentialsUsed: false,
        hostLimitation:
          "Claude adapter does not project paused/budget statuses. T3 rejects active /goal commands before connector input; active controls use /bruv goal, idle resume uses /goal resume. Partial second-response text is verified on wire; native UI may show Thinking until the assistant message completes.",
      },
      null,
      2,
    )}\n`,
  );
}

export async function capture({ page, records, proof }) {
  // The shared replay invokes this hook before exercising the page as well as
  // during final wire export; the first call records redacted native actions.
  if (!records) {
    if (!page?.on) return {};
    const nativeActions = [];
    page.on("websocket", (socket) => {
      for (const direction of ["framesent", "framereceived"])
        socket.on(direction, ({ payload }) => {
          let decoded;
          try {
            decoded = JSON.parse(typeof payload === "string" ? payload : Buffer.from(payload).toString("utf8"));
          } catch {
            return;
          }
          const fields = [];
          const walk = (value, location = "root", depth = 0) => {
            if (!value || typeof value !== "object" || depth > 14) return;
            for (const [key, item] of Object.entries(value)) {
              if (
                typeof item === "string" &&
                ["_tag", "tag", "type", "kind", "method", "status", "reason", "error", "message"].includes(key)
              )
                fields.push({
                  path: `${location}.${key}`,
                  value: item.slice(0, 400).replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi, "<ID>"),
                });
              else if (item && typeof item === "object") walk(item, `${location}.${key}`, depth + 1);
            }
          };
          walk(decoded);
          if (fields.length) nativeActions.push({ direction, fields });
        });
    });
    return { nativeActions };
  }
  const rows = records
    .filter((row) => ["stdin", "stdout"].includes(row.kind))
    .map(({ kind, value: frame }) => {
      const text = content(frame.message?.content);
      return {
        direction: kind,
        type: frame.type,
        subtype: frame.subtype,
        state: frame.state,
        model: frame.message?.model,
        terminalReason: frame.terminal_reason,
        appLeaseReconnectDenied:
          JSON.stringify(frame.errors ?? []).includes("App-owned MCP reconnect failed or was denied") || undefined,
        priority: frame.priority,
        streamEvent: frame.event?.type,
        fixtureDelta: ["GOAL_SECOND_PENDING_REAL", "GOAL_RESUMED_PENDING_REAL"].includes(
          frame.event?.delta?.text?.trim(),
        )
          ? frame.event.delta.text.trim()
          : undefined,
        commandUuidHash: frame.command_uuid ? hash(frame.command_uuid) : undefined,
        userUuidHash: frame.user_message_uuid ? hash(frame.user_message_uuid) : undefined,
        userUuidHashes: frame.user_message_uuids?.map(hash),
        inputUuidHash: kind === "stdin" && frame.uuid ? hash(frame.uuid) : undefined,
        goalMarker:
          frame.message?.model === "<synthetic>" && /^(?:Goal set:|Goal cleared:|No goal set)/.test(text)
            ? text.replaceAll(objective, "<OBJECTIVE>").replaceAll(budgetObjective, "<BUDGET_OBJECTIVE>")
            : undefined,
        goalStatus: /\bStatus: ([a-z_]+)/.exec(text)?.[1],
      };
    });
  await fs.writeFile(path.join(proof, "goal-controls-wire.json"), `${JSON.stringify(rows, null, 2)}\n`);
}

export async function flushCapture({ proof, observation }) {
  if (observation?.nativeActions)
    await fs.writeFile(
      path.join(proof, "goal-native-actions.json"),
      `${JSON.stringify(observation.nativeActions, null, 2)}\n`,
    );
}
