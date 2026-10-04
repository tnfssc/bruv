import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { prepare, captureIdentity, projectWire, waitForProcessExit } from "./driver.mjs";
import { modelSlug, title, cancelTitle, stopTitle } from "./subagent-model.mjs";
import { collectReturnEvidence } from "./subagent-return-evidence.mjs";
export { prepare, captureIdentity };
async function waitFile(file) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      await fs.access(file);
      return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Missing actual child file: " + path.basename(file));
}
let observedConfig;
export async function exercise({ page, url, snapshot, config }) {
  observedConfig = config;
  // The shared replay already completed the real native ready/new-thread flow.
  const message = page.getByRole("textbox", { name: "Message", exact: true });
  const newThread = async () => {
    await page.getByRole("button", { name: "New thread", exact: true }).click();
    // Current upstream opens its native project picker before creating the draft.
    await page.locator('[data-slot="command-item"]').filter({ has: page.getByText("project", { exact: true }) }).first().click();
    await message.waitFor();
    await page.locator('[data-chat-provider-model-picker="true"]').first().click();
    await page.getByText("Local deterministic acceptance (not Claude)", { exact: true }).last().click();
  };
  await message.waitFor();
  await page.locator('[data-chat-provider-model-picker="true"]').first().click();
  await page.getByText("Local deterministic acceptance (not Claude)", { exact: true }).last().click();
  await snapshot("model-identity");
  const submit = async (text) => {
    await message.fill(text);
    await page.getByRole("button", { name: "Submit message", exact: true }).click();
  };
  const visible = async (text) => page.getByText(text, { exact: false }).first().waitFor({ timeout: 30000 });
  await submit("ACCEPT_LOCAL_SUBAGENT: launch the actual normal Bruv worker locally with waitSeconds zero.");
  await waitFile(path.join(config.state, "child.ready"));
  await visible("ROOT_BACKGROUND_RETURN_REAL");
  await page
    .getByText(/^Worked for /)
    .first()
    .click();
  await visible(title);
  const nativeCard = page.locator('[data-v2-item-type="subagent"]').filter({ hasText: title });
  assert.equal(await nativeCard.getAttribute("aria-description"), "Running");
  await snapshot("agent-running");
  // A separate user turn while the real child is pending; completion must survive it.
  await submit("ACCEPT_LOCAL_FOLLOWUP: acknowledge this followup while the normal child is still running.");
  await visible("ROOT_FOLLOWUP_REAL");
  await snapshot("followup-before-completion");
  await fs.writeFile(path.join(config.state, "child.release"), "release");
  await visible("ROOT_COMPLETION_ONCE_REAL");
  await page
    .getByText(/^Worked for /)
    .first()
    .click();
  await visible(title);
  assert.equal(await nativeCard.getAttribute("aria-description"), "Completed");
  await snapshot("agent-completed");
  const completedRootUrl = page.url();
  // Inspect the real card, not an inferred runnable child control.
  await page.getByRole("button", { name: "Open " + title, exact: true }).click();
  await page.waitForTimeout(750);
  await snapshot("child-transcript-attempt");
  await visible("CHILD_ANSWER_REAL");
  await visible("Completed");
  await page
    .getByText(/^Worked for /)
    .first()
    .click();
  await visible("Execute");
  await snapshot("child-transcript-expanded");
  await page.getByText("Execute", { exact: true }).first().click();
  await page.waitForTimeout(500);
  await snapshot("child-tool-inspector");
  const body = await page.locator("body").innerText();
  config.renderedChildTranscript =
    body.includes("CHILD_ANSWER_REAL") && body.includes("Actual local subagent acceptance");
  config.renderedChildToolResult = await page.getByText("CHILD_TOOL_RESULT_REAL", { exact: true }).isVisible();
  assert.ok(config.renderedChildTranscript, "Actual rendered child transcript and tool input access");
  await fs.writeFile(
    path.join(config.proof, "rendered-child-access.json"),
    JSON.stringify(
      {
        accessed: config.renderedChildTranscript,
        renderedToolResult: config.renderedChildToolResult,
        runnableChildControlClaimed: false,
      },
      null,
      2,
    ) + "\n",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open parent", exact: true }).click();
  await message.waitFor();
  assert.equal(page.url(), completedRootUrl, "Child view returns to the same completed root");
  await snapshot("same-root-return-before-input");
  try {
    await message.fill("ACCEPT_LOCAL_AFTER_CHILD: reply in this same root after child transcript return.");
    // A success result is not enough: the real native composer must admit the next prompt.
    await page.getByRole("button", { name: "Submit message", exact: true }).click({ timeout: 10000 });
    await visible("ROOT_AFTER_CHILD_REAL");
    await page
      .getByRole("button", { name: "Stop generation", exact: true })
      .waitFor({ state: "hidden", timeout: 10000 });
    await page.getByRole("button", { name: "Submit message", exact: true }).waitFor();
    assert.equal(page.url(), completedRootUrl, "Next actual model reply stays in the same root");
    config.sameRootChildReturnReply = true;
    await snapshot("same-root-next-reply");
  } finally {
    await collectReturnEvidence(config, page);
  }
  // Cancellation/Stop use independent roots only AFTER same-root continuation passes.
  await newThread();
  await submit("ACCEPT_LOCAL_CANCEL: launch and explicitly stop another actual normal worker.");
  await visible("ROOT_KILLED_COMPLETION_REAL");
  await waitForProcessExit(path.join(config.state, "cancel.worker.pid"));
  await waitForProcessExit(path.join(config.state, "cancel.ready"));
  await snapshot("actual-cancel-completed");
  await newThread();
  await submit("ACCEPT_LOCAL_STOP: launch another actual normal worker and hold root generation.");
  await waitFile(path.join(config.state, "stop.ready"));
  await snapshot("before-stop");
  await page.getByRole("button", { name: "Stop generation", exact: true }).click();
  await visible("Run interrupted by user");
  await waitForProcessExit(path.join(config.state, "stop.worker.pid"));
  await waitForProcessExit(path.join(config.state, "stop.ready"));
  await waitForProcessExit(path.join(config.state, "stop.root-tool.pid"));
  await snapshot("stop-owned-subtree-exited");
  await submit("ACCEPT_LOCAL_FOLLOWUP: continue after default Stop closed the owned subtree.");
  await page.waitForTimeout(1000);
  await visible("ROOT_FOLLOWUP_REAL");
  await snapshot("continued-after-stop");
}
export function checkSameRootReply(wire) {
  const out = wire.filter((x) => x.kind === "stdout").map((x) => x.value);
  const answer = (marker) =>
    out.filter(
      (m) =>
        m.type === "assistant" &&
        !m.parent_tool_use_id &&
        m.message?.content?.some((c) => c.type === "text" && c.text === marker),
    );
  const initial = answer("ROOT_BACKGROUND_RETURN_REAL");
  const next = answer("ROOT_AFTER_CHILD_REAL");
  assert.equal(initial.length, 1, "Exactly one initial root reply");
  assert.equal(next.length, 1, "Exactly one actual same-root next reply");
  assert.ok(initial[0].session_id, "Actual native root session identity");
  assert.equal(next[0].session_id, initial[0].session_id, "Next model reply belongs to original root session");
  const result = out.filter((m) => m.type === "result" && m.result === "ROOT_AFTER_CHILD_REAL");
  assert.equal(result.length, 1, "Next reply has its own actual success result");
  assert.equal(result[0].session_id, initial[0].session_id);
  assert.equal(result[0].is_error, false);
  return { sameRootSessionReply: true };
}
export function checkConsumedPromptOwnership(wire) {
  const echoed = (m) => m.user_message_uuids ?? (m.user_message_uuid ? [m.user_message_uuid] : []);
  for (const [prompt, answer] of [
    ["ACCEPT_LOCAL_SUBAGENT", "ROOT_BACKGROUND_RETURN_REAL"],
    ["ACCEPT_LOCAL_FOLLOWUP", "ROOT_FOLLOWUP_REAL"],
    ["ACCEPT_LOCAL_AFTER_CHILD", "ROOT_AFTER_CHILD_REAL"],
  ]) {
    const input = wire.find(
      (e) => e.kind === "stdin" && e.value.type === "user" && JSON.stringify(e.value.message?.content).includes(prompt),
    );
    assert.ok(input?.value.uuid, "Actual offered prompt UUID: " + prompt);
    const result = wire.find(
      (e) => e.kind === "stdout" && e.value.type === "result" && e.value.result === answer,
    )?.value;
    assert.ok(result, "Actual prompt result: " + answer);
    assert.ok(echoed(result).includes(input.value.uuid), "Consumed prompt UUID missing/wrong: " + prompt);
  }
  const wake = wire.find(
    (e) => e.kind === "stdout" && e.value.type === "result" && e.value.result === "ROOT_COMPLETION_ONCE_REAL",
  )?.value;
  assert.equal(
    wake?.origin?.kind,
    "task-notification",
    "Actual autonomous result has non-human task-notification origin",
  );
  assert.equal(echoed(wake).length, 0, "Autonomous result must not recharge a consumed human prompt UUID");
  return { consumedPromptOwnership: true };
}
export async function verify({ wire, config, proof, t3Version, t3BinarySha256 }) {
  assert.equal(
    config.sameRootChildReturnReply,
    true,
    "Actual same-root browser return, admission and next reply required",
  );
  checkSameRootReply(wire);
  checkConsumedPromptOwnership(wire);
  const out = wire.filter((x) => x.kind === "stdout").map((x) => x.value);
  const starts = out.filter((m) => m.type === "system" && m.subtype === "task_started");
  const ends = out.filter((m) => m.type === "system" && m.subtype === "task_notification");
  assert.equal(starts.length, 3, "Three actual local worker starts");
  assert.equal(ends.length, 2, "Complete and explicit cancellation terminal notifications; Stop closes connector");
  assert.ok(starts.every((s) => s.task_type === "local_agent" && s.subagent_type === "normal" && s.is_backgrounded));
  assert.equal(ends[1].status, "stopped");
  assert.equal(ends[1].task_id, starts[1].task_id);
  assert.equal(ends[0].status, "completed");
  assert.equal(ends[0].task_id, starts[0].task_id);
  assert.equal(
    out.filter(
      (m) =>
        m.type === "assistant" &&
        !m.parent_tool_use_id &&
        m.message?.content?.some((c) => c.type === "text" && c.text === "ROOT_CANCEL_CONFIRMED_REAL"),
    ).length,
    1,
    "Actual confirmed cancellation answer exactly once in native wire",
  );
  const tools = out
    .filter((m) => m.type === "assistant" && !m.parent_tool_use_id)
    .flatMap((m) => m.message?.content ?? [])
    .filter((c) => c.type === "tool_use");
  assert.equal(tools.filter((c) => c.name === "execute").length, 3, "No duplicate root execute launch");
  const rootModelMessages = out.filter(
    (m) =>
      m.type === "assistant" &&
      !m.parent_tool_use_id &&
      m.message?.model === modelSlug &&
      m.message.usage.input_tokens + m.message.usage.output_tokens > 0,
  );
  const rootTokens = rootModelMessages.reduce(
    (n, m) => n + m.message.usage.input_tokens + m.message.usage.output_tokens,
    0,
  );
  assert.equal(rootModelMessages.length, 10, "Actual root model turns, no duplicated child turns");
  assert.equal(rootTokens, 180, "Actual root usage only, child tokens not added");
  assert.equal(ends[0].usage.total_tokens, 36, "Actual child usage exactly two model calls");
  const rootResultTokens = out
    .filter((m) => m.type === "result" && m.usage)
    .reduce((n, m) => n + m.usage.input_tokens + m.usage.output_tokens, 0);
  assert.equal(rootResultTokens, rootTokens, "Native per-generation result usage excludes child tokens");
  const agents = tools.filter((c) => c.name === "Agent");
  assert.equal(agents.length, 3, "Real native Agent call");
  const launchFrames = out.filter((m) => m.type === "assistant" && m.bruv?.jobId);
  assert.equal(new Set(launchFrames.map((m) => m.bruv.jobId)).size, 3, "Distinct actual local job IDs");
  const launchSources = [];
  for (const frame of launchFrames) {
    const entries = (await fs.readFile(frame.bruv.sourceSessionId, "utf8")).trim().split("\n").map(JSON.parse);
    const bindings = entries.filter(
      (e) =>
        e.type === "custom" &&
        e.customType === "bruv-native-task-projection" &&
        e.data?.cursor?.link?.jobId === frame.bruv.jobId,
    );
    assert.ok(bindings.length, "Persisted real task projection cursor");
    const call = entries.find(
      (e) =>
        e.type === "message" &&
        e.message.role === "assistant" &&
        e.message.content.some((c) => c.id === frame.bruv.sourceCallId),
    );
    assert.ok(call, "Actual root execute source call resolves");
    launchSources.push({ launch: frame.bruv, call, bindings });
  }
  const stopIndex = wire.findIndex(
    (x) => x.kind === "stdin" && x.value?.type === "control_request" && x.value.request?.subtype === "interrupt",
  );
  assert.ok(stopIndex >= 0, "Real native Stop interrupt");
  assert.ok(
    wire.slice(stopIndex + 1).some((x) => x.kind === "lifecycle" && x.value?.event === "exit"),
    "Stop closes owning connector",
  );
  assert.ok(
    wire.slice(stopIndex + 1).some((x) => x.kind === "lifecycle" && x.value?.event === "spawn"),
    "Continue starts a new query owner",
  );
  await fs.writeFile(
    path.join(proof, "source-task-bindings.json"),
    JSON.stringify(launchSources, null, 2).replaceAll(path.dirname(config.state), "<FIXTURE>") + "\n",
  );
  await fs.writeFile(path.join(proof, "task-events.json"), JSON.stringify({ starts, ends, agents }, null, 2) + "\n");
  await fs.writeFile(
    path.join(proof, "wire-projection.ndjson"),
    projectWire(wire)
      .map((x) => JSON.stringify(x))
      .join("\n") + "\n",
  );
  await fs.writeFile(
    path.join(proof, "result.json"),
    JSON.stringify(
      {
        focusedLocalSubagent: true,
        modelIdentity: modelSlug,
        t3Version,
        t3BinarySha256,
        upstreamUnmodified: true,
        syntheticConnectorEvents: false,
        realCredentialsUsed: false,
        taskStarts: starts.length,
        taskEnds: ends.length,
        rootExecuteCalls: 3,
        rootModelMessages: rootModelMessages.length,
        rootTokens,
        childTokens: ends[0].usage.total_tokens,
        consumedPromptOwnership: true,
        sameRootChildReturnReply: config.sameRootChildReturnReply ?? false,
        renderedChildTranscript: config.renderedChildTranscript ?? false,
        renderedChildToolResult: config.renderedChildToolResult ?? false,
        runnableChildControlsClaimed: false,
      },
      null,
      2,
    ) + "\n",
  );
}

export async function flushCapture() {
  const config = observedConfig ?? JSON.parse(await fs.readFile(process.env.BRUV_ACCEPTANCE_CONFIG, "utf8"));
  await collectReturnEvidence(config, undefined, "final-provider-evidence.json");
}
