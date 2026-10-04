import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { workerModels, workerSlug, workerInstance } from "./app-delegation-model.mjs";
import { modelSlug } from "./model.mjs";
import { projectWire as baseProjectWire } from "./driver.mjs";
export { captureIdentity } from "./driver.mjs";
export function projectWire(wire) {
  return baseProjectWire(wire).map((value, index) => ({
    ...value,
    instance: wire[index].instance,
    ...(wire[index].kind === "scope" ? { scope: wire[index].value } : {}),
  }));
}
export async function prepare({ base, fixture, config }) {
  const root = path.dirname(config.state),
    agent = config.env.BRUV_CLAUDE_COMPAT_HOME;
  const normalAgent = path.join(root, "normal-agent");
  await fs.mkdir(normalAgent);
  const port = config.workerModelPort;
  await fs.writeFile(path.join(normalAgent, "models.json"), JSON.stringify(workerModels(port)));
  const bruv = path.join(config.env.HOME, ".bruv");
  await fs.mkdir(bruv, { recursive: true });
  await fs.writeFile(
    path.join(bruv, "subagents.json"),
    JSON.stringify({ normal: { model: workerSlug, thinking: "high" } }),
  );
  await fs.writeFile(
    path.join(agent, "native-app-worker.json"),
    JSON.stringify({
      role: "orchestrator",
      depth: 0,
      worker: {
        type: "normal",
        thinking: "high",
        target: { providerInstanceId: workerInstance, model: workerSlug, options: [{ id: "effort", value: "high" }] },
        runtimeMode: "full-access",
        interactionMode: "default",
      },
    }),
  );
  await fs.writeFile(path.join(normalAgent, "native-app-worker.json"), JSON.stringify({ role: "normal", depth: 1 }));
  config.workerTap = path.join(root, "normal-connector-tap");
  await fs.copyFile(fixture, config.workerTap);
  await fs.chmod(config.workerTap, 0o755);
  config.workerEnv = {
    BRUV_CLAUDE_COMPAT_HOME: normalAgent,
    BRUV_CODING_AGENT_DIR: normalAgent,
    CLAUDE_CONFIG_DIR: path.join(normalAgent, "native-history"),
    BRUV_SUBAGENT_TYPE: "normal",
    BRUV_SUBAGENT_DEPTH: "1",
  };
  await fs.writeFile(config.env.BRUV_ACCEPTANCE_CONFIG, JSON.stringify(config), { mode: 0o600 });
  const dir = path.join(base, "userdata");
  await fs.mkdir(dir, { recursive: true });
  const custom = (slug, name, reasoning = false) => ({
    slug,
    name,
    capabilities: {
      optionDescriptors: reasoning
        ? [
            {
              id: "effort",
              label: "Reasoning effort",
              type: "select",
              currentValue: "high",
              options: [{ id: "high", label: "High", isDefault: true }],
            },
          ]
        : [],
    },
  });
  const provider = (displayName, binary, home, model) => ({
    driver: "claudeAgent",
    enabled: true,
    displayName,
    config: { binaryPath: binary, homePath: home, customModels: [model] },
  });
  await fs.writeFile(
    path.join(dir, "settings.json"),
    JSON.stringify(
      {
        providerInstances: {
          claudeAgent: provider(
            "Bruv local deterministic acceptance (not Claude)",
            fixture,
            config.env.CLAUDE_CONFIG_DIR,
            custom(modelSlug, "Local deterministic acceptance (not Claude)"),
          ),
          [workerInstance]: provider(
            "Bruv native normal worker (not Claude)",
            config.workerTap,
            config.workerEnv.CLAUDE_CONFIG_DIR,
            custom(workerSlug, "Local normal worker (not Claude)", true),
          ),
        },
      },
      null,
      2,
    ),
  );
}
async function waitFile(file) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    try {
      await fs.access(file);
      return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Actual child did not reach " + path.basename(file));
}
export async function exercise({ page, url, snapshot, body, config }) {
  // Shared replay already selected the native project and prepared this draft.
  const message = page.getByRole("textbox", { name: "Message", exact: true });
  await message.waitFor();
  await page.locator('[data-chat-provider-model-picker="true"]').first().click();
  await page.getByText("Local deterministic acceptance (not Claude)", { exact: true }).last().click();
  const submit = async (s) => {
    await message.fill(s);
    await page.getByRole("button", { name: "Submit message", exact: true }).click();
  };
  const visible = async (s) => page.getByText(s, { exact: false }).last().waitFor({ timeout: 40000 });
  await snapshot("root-model");
  await submit("APP_DELEGATE_DONE: delegate to the explicitly configured normal native provider.");
  await visible("APP_TASK_PENDING_REAL_done");
  await waitFile(path.join(config.state, "done.started"));
  await page.getByText("Waiting on subagent Native normal done", { exact: true }).waitFor({ timeout: 40000 });
  await snapshot("native-child-running");
  // The UI must display the actual native child, not a connector-authored task frame.
  assert.ok((await body()).includes("Native normal done"), "Native child title rendered");
  await fs.writeFile(path.join(config.state, "done.release"), "actual browser-driven release");
  await visible("APP_COMPLETION_ACK_REAL");
  await snapshot("native-child-completed-ack");
  const parentUrl = page.url();
  // 2644 exposes completion as a titled Finished subagent card.
  await page
    .locator('[data-v2-item-type="subagent"][aria-description="Finished"]')
    .filter({ hasText: "Native normal done" })
    .click();
  await visible("APP_CHILD_RESULT_REAL_done");
  await snapshot("native-child-thread-completed");
  assert.ok(
    (await body()).includes("Local normal worker (not Claude)"),
    "Actual child UI selects distinct worker model",
  );
  // App-owned children now expose the parent through Lineage/the native sidebar,
  // not the provider-only child view's generic Open parent control.
  await page.locator("[data-thread-item]").filter({ hasText: "APP_DELEGATE_DONE" }).first().click();
  await message.waitFor();
  assert.equal(page.url(), parentUrl, "Native child returns to the same parent root");
  await submit("APP_DELEGATE_CANCEL: create a real normal native child to cancel.");
  await visible("APP_TASK_PENDING_REAL_cancel");
  await waitFile(path.join(config.state, "cancel.started"));
  await snapshot("native-child-cancel-running");
  await submit("APP_CANCEL: cancel and inspect the real app-owned task.");
  await visible("APP_CANCEL_CONFIRMED_REAL");
  await snapshot("native-child-cancelled");
  await fs.writeFile(path.join(config.state, "cancel.release"), "release cancelled provider request");
  await page.waitForTimeout(1500);
}
export async function verify({ wire, config, proof, t3Version, t3BinarySha256 }) {
  const tasks = await Promise.all(
    ["done", "cancel"].map(async (n) =>
      JSON.parse(await fs.readFile(path.join(config.state, n + ".task.json"), "utf8")),
    ),
  );
  assert.ok(tasks.every((t) => t.taskId && t.childThreadId));
  assert.notEqual(tasks[0].taskId, tasks[1].taskId);
  const db = new DatabaseSync(path.join(path.dirname(config.state), "t3-runtime/t3-base/userdata/statev2.sqlite"), {
    readOnly: true,
  });
  let native;
  try {
    native = tasks.map((t) => {
      const task = JSON.parse(
        db.prepare("SELECT payload_json FROM orchestration_v2_projection_subagents WHERE subagent_id=?").get(t.taskId)
          .payload_json,
      );
      const child = JSON.parse(
        db
          .prepare("SELECT payload_json FROM orchestration_v2_projection_threads WHERE thread_id=?")
          .get(t.childThreadId).payload_json,
      );
      return {
        id: task.id,
        threadId: task.threadId,
        childThreadId: task.childThreadId,
        origin: task.origin,
        status: task.status,
        completionDelivery: task.completionDelivery,
        modelSelection: child.modelSelection,
        lineage: child.lineage,
      };
    });
  } finally {
    db.close();
  }
  await fs.writeFile(path.join(proof, "native-task-state.json"), JSON.stringify(native, null, 2));
  assert.equal(native[0].status, "completed");
  assert.equal(native[1].status, "interrupted");
  assert.equal(native[0].completionDelivery?.state, "acknowledged", "Native task_status commits terminal result ACK");
  assert.equal(native[1].completionDelivery?.state, "disposed", "Native task_cancel disposes its completion wake");
  assert.ok(
    native.every((t) => t.origin === "app_owned"),
    "Actual native app-owned origin",
  );
  assert.ok(
    native.every(
      (t) =>
        t.modelSelection.instanceId === workerInstance &&
        t.modelSelection.model === workerSlug &&
        t.modelSelection.options.some((o) => o.id === "effort" && o.value === "high"),
    ),
    "Actual native stored child selection pins instance/model/effort",
  );
  assert.ok(
    native.every((t) => t.lineage.relationshipToParent === "subagent"),
    "Actual native child lineage",
  );
  const scopes = wire.filter((x) => x.kind === "scope" && x.value.hasCredential);
  await fs.writeFile(path.join(proof, "native-scopes.json"), JSON.stringify(scopes, null, 2));
  const root = new Set(scopes.filter((x) => x.instance === "root").map((x) => x.value.credentialDigest));
  const normal = scopes.filter((x) => x.instance === "normal");
  assert.ok(normal.length >= 2, "Real native child query processes launched");
  assert.ok(
    normal.every((x) => !root.has(x.value.credentialDigest)),
    "Child native credentials differ from root",
  );
  assert.ok(
    normal.every(
      (x) =>
        x.value.model === workerSlug &&
        x.value.thinking === "adaptive" &&
        x.value.role === "normal" &&
        x.value.depth === "1",
    ),
    "Exact normal model and adaptive reasoning passed by unchanged T3 (old connector version warns; SDK omits effort flag)",
  );
  const out = wire.filter((x) => x.kind === "stdout" && x.instance === "root").map((x) => x.value);
  assert.equal(
    out.filter((x) => x.type === "system" && ["task_started", "task_notification"].includes(x.subtype)).length,
    0,
    "No duplicated connector job/notification for app task",
  );
  const cancelledOutput = wire.filter(
    (x) => x.kind === "stdout" && x.instance === "normal" && x.value.type === "assistant",
  );
  assert.ok(
    !cancelledOutput.some((x) => JSON.stringify(x.value.message?.content).includes("APP_CHILD_RESULT_REAL_cancel")),
    "Cancelled actual child cannot publish late provider result",
  );
  await fs.writeFile(
    path.join(proof, "task-status.json"),
    JSON.stringify(
      {
        done: await fs.readFile(path.join(config.state, "done.status.json"), "utf8"),
        cancel: await fs.readFile(path.join(config.state, "cancel.status.json"), "utf8"),
      },
      null,
      2,
    ),
  );
  await fs.writeFile(
    path.join(proof, "result.json"),
    JSON.stringify(
      {
        passed: true,
        appOwnedDelegation: true,
        t3Version,
        t3BinarySha256,
        upstreamUnmodified: true,
        syntheticConnectorEvents: false,
        realCredentialsUsed: false,
        namedWorkerInstance: workerInstance,
        workerModel: workerSlug,
        workerThinking: "high",
        normalRoleDepth: 1,
        childScopesDistinct: true,
        noDuplicateBruvNotifications: true,
        actualNativeChildCount: tasks.length,
        nativeTerminalAck: true,
        cancellationTerminal: "interrupted",
      },
      null,
      2,
    ),
  );
}
