import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { modelSlug } from "./model.mjs";
import { projectWire } from "./driver.mjs";
const hash = (x) => createHash("sha256").update(x).digest("hex").slice(0, 16);
async function ledger(config) {
  const files = await fs.readdir(config.env.BRUV_CODING_AGENT_DIR, { recursive: true });
  const entries = [];
  for (const file of files.filter((f) => f.endsWith(".questions.json")))
    entries.push(...JSON.parse(await fs.readFile(path.join(config.env.BRUV_CODING_AGENT_DIR, file), "utf8")));
  return entries;
}
async function wire(config) {
  try {
    return (await fs.readFile(config.wire, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
  } catch {
    return [];
  }
}
async function poll(read, test, label) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    const value = await read();
    if (test(value)) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Timed out: " + label);
}
const projected = (q) => ({
  idHash: hash(q.id),
  ownerHash: hash(JSON.stringify(q.owner)),
  version: q.version,
  status: q.status,
  answer: q.answer,
  delivery: q.delivery,
  replyVersion: q.replyVersion,
  blocked: q.blocked,
});
export async function exercise({ page, url, snapshot: nativeSnapshot, config }) {
  const snapshot = async (name) => {
    await nativeSnapshot(name);
    const file = path.join(config.proof, name + ".txt");
    await fs.writeFile(file, (await fs.readFile(file, "utf8")).replaceAll(path.dirname(config.state), "<FIXTURE>"));
  };
  const evidence = {
    checks: [],
    ledger: [],
    effects: [],
    stopControl:
      "official thread.stop bound to Ctrl+Escape in scoped keybindings.json; approval composer hides Stop button",
  };
  const save = async () =>
    fs.writeFile(path.join(config.proof, "human-observations.json"), JSON.stringify(evidence, null, 2) + "\n");
  const record = async (name) => {
    const qs = await ledger(config);
    evidence.ledger.push({ step: name, questions: qs.map(projected) });
    await snapshot(name);
    await save();
    return qs;
  };
  // The shared harness already completed the real native empty/new-thread flow.
  const message = page.getByRole("textbox", { name: "Message", exact: true });
  await message.waitFor();
  await page.locator('[data-chat-provider-model-picker="true"]').first().click();
  await page.getByText("Local deterministic acceptance (not Claude)", { exact: true }).last().click();
  await page.getByLabel("Runtime mode", { exact: true }).click();
  await page.getByText("Supervised", { exact: true }).click();
  await snapshot("human-model-supervised");
  const submit = async (text) => {
    await message.fill(text);
    await page.getByRole("button", { name: "Submit message", exact: true }).click({ timeout: 30000 });
  };
  const visible = async (text) => {
    await page.getByText(text, { exact: false }).last().waitFor({ timeout: 30000 });
    await page.waitForTimeout(600);
  };
  const exists = async (file) => {
    try {
      await fs.access(file);
      return true;
    } catch {
      return false;
    }
  };
  for (const scenario of ["allow", "deny", "stop"]) {
    await submit("HUMAN_PERMISSION_" + scenario + ": request actual execute side effect.");
    await page.getByRole("button", { name: "Approve", exact: true }).waitFor({ timeout: 30000 });
    assert.equal(
      await exists(path.join(config.state, "permission-" + scenario + ".effect")),
      false,
      "effect must not happen before consent",
    );
    await snapshot("permission-" + scenario + "-pending");
    if (scenario === "stop") {
      await page.keyboard.press("Control+Escape");
      await visible("Run interrupted by user");
      const pending = (await wire(config))
        .filter(
          (x) => x.kind === "stdout" && x.value.type === "control_request" && x.value.request.tool_name === "execute",
        )
        .at(-1).value;
      await poll(
        () => wire(config),
        (rows) =>
          rows.some(
            (x) =>
              x.kind === "stdout" &&
              x.value.type === "control_cancel_request" &&
              x.value.request_id === pending.request_id,
          ),
        "real pending consent cancelled",
      );
      evidence.staleApprovalAfterStop = await page.getByRole("button", { name: "Approve", exact: true }).isVisible();
      await snapshot("permission-stop-interrupted");
      // Official T3 persists its already-cancelled approval card even on reload.
      // Preserve the defect frame; explicitly Decline it through the real UI.
      if (evidence.staleApprovalAfterStop) await page.getByRole("button", { name: "Decline", exact: true }).click();
      assert.equal(await exists(path.join(config.state, "permission-stop.effect")), false);
      await page.reload();
      await page
        .locator("[data-thread-item]")
        .filter({ hasText: "HUMAN_PERMISSION_allow" })
        .first()
        .click({ timeout: 30000 });
      await message.waitFor({ timeout: 30000 });
      await page.getByRole("button", { name: "Approve", exact: true }).waitFor({ state: "hidden" });
    } else {
      await page.getByRole("button", { name: scenario === "allow" ? "Approve" : "Decline", exact: true }).click();
      await visible("HUMAN_PERMISSION_" + scenario + "_RESULT_REAL");
    }
    assert.equal(await exists(path.join(config.state, "permission-" + scenario + ".effect")), scenario === "allow");
    evidence.effects.push({
      scenario,
      beforeConsent: false,
      afterConsent: await exists(path.join(config.state, "permission-" + scenario + ".effect")),
      content:
        scenario === "allow"
          ? await fs.readFile(path.join(config.state, "permission-allow.effect"), "utf8")
          : undefined,
    });
    evidence.checks.push("execute " + scenario + " real side effect=" + (scenario === "allow"));
    await record("permission-" + scenario + "-result");
  }
  // Commands must be real human operations, not tools or model prompts.
  await submit("HUMAN_QUESTION_ASK: save the actual human question.");
  await page.getByRole("button", { name: "Approve", exact: true }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await visible("Acceptance saved human question");
  await page.getByRole("button", { name: "Keep pending (do not answer)", exact: false }).waitFor();
  await page.waitForTimeout(500);
  let q = (await record("question-native-dialog")).find((q) => q.dedupKey === "human-controls-acceptance");
  assert.ok(q);
  assert.equal(q.status, "pending");
  const identity = q.id,
    owner = JSON.stringify(q.owner),
    version = q.version;
  await page.getByRole("button", { name: "Keep pending (do not answer)", exact: false }).click();
  await visible("HUMAN_QUESTION_SAVED_REAL");
  q = (await record("question-declined-pending")).find((q) => q.id === identity);
  assert.equal(q.status, "pending");
  assert.equal(q.version, version);
  assert.equal(q.answer, undefined);
  await submit("/bruv questions open " + identity);
  await page.getByRole("button", { name: "Keep pending (do not answer)", exact: false }).waitFor();
  await record("question-explicit-reopen");
  await page.keyboard.press("Control+Escape");
  await visible("Run interrupted by user");
  q = (await record("question-stop-pending")).find((q) => q.id === identity);
  assert.equal(q.status, "pending");
  assert.equal(q.version, version);
  await page.reload();
  await page
    .locator("[data-thread-item]")
    .filter({ hasText: "HUMAN_PERMISSION_allow" })
    .first()
    .click({ timeout: 30000 });
  await message.waitFor({ timeout: 30000 });
  await submit("/bruv questions open " + identity);
  await page.getByRole("button", { name: "Use local fixture", exact: false }).waitFor({ timeout: 30000 });
  q = (await record("question-resume-same-identity")).find((q) => q.id === identity);
  assert.equal(q.status, "pending");
  assert.equal(q.version, version);
  assert.equal(JSON.stringify(q.owner), owner);
  await page.getByRole("button", { name: "Use local fixture", exact: false }).click();
  await poll(
    () => ledger(config),
    (qs) => qs.some((q) => q.id === identity && q.status === "answered"),
    "explicit answer saved",
  );
  q = (await record("question-answer-saved-resume-needed")).find((q) => q.id === identity);
  assert.equal(q.answer, "Use local fixture");
  assert.equal(q.delivery, "resume-needed", "recovered questions require explicit human resume");
  // Official T3 can keep a zero-model command Working despite its real success
  // result. Close that native owner through the actual Stop control; the saved
  // answered reply remains resume-needed and is resumed on a fresh owner.
  if (!(await page.getByRole("button", { name: "Submit message", exact: true }).isVisible())) {
    await page.keyboard.press("Control+Escape");
    evidence.zeroModelCommandStopRecovery = true;
  }
  await page.reload();
  await page
    .locator("[data-thread-item]")
    .filter({ hasText: "HUMAN_PERMISSION_allow" })
    .first()
    .click({ timeout: 30000 });
  await message.waitFor({ timeout: 30000 });
  q = (await record("question-answer-reopened-before-resume")).find((q) => q.id === identity);
  assert.equal(q.status, "answered");
  assert.equal(q.delivery, "resume-needed");
  assert.equal(q.answer, "Use local fixture");
  await submit("/bruv questions resume " + identity);
  // Resolving the ledger is another actual execute: explicitly approve it, never an answer callback.
  await page.getByRole("button", { name: "Approve", exact: true }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await visible("HUMAN_ANSWER_DELIVERED_ONCE_REAL");
  q = (await record("question-answer-used-once")).find((q) => q.id === identity);
  assert.equal(q.status, "resolved");
  assert.equal(q.answer, "Use local fixture");
  assert.equal(q.delivery, "delivered");
  await page.reload();
  await page
    .locator("[data-thread-item]")
    .filter({ hasText: "HUMAN_PERMISSION_allow" })
    .first()
    .click({ timeout: 30000 });
  await message.waitFor({ timeout: 30000 });
  await submit("/bruv questions open " + identity);
  await visible("[resolved]");
  await page.keyboard.press("Control+Escape");
  await page.reload();
  await page
    .locator("[data-thread-item]")
    .filter({ hasText: "HUMAN_PERMISSION_allow" })
    .first()
    .click({ timeout: 30000 });
  await message.waitFor({ timeout: 30000 });
  await submit("HUMAN_CONTINUE: continue without replaying saved answer.");
  await visible("HUMAN_CONTINUED_REAL");
  await record("question-no-duplicate-after-reopen");
  evidence.checks.push(
    "saved question real native dialog",
    "decline remains pending",
    "Stop remains pending",
    "same owner/id/version reopen; saved answer requires explicit resume",
    "one human answer delivered and resolved",
    "native commands are not model prompts",
  );
  await save();
}
export function checkHumanWire(records) {
  const requests = records.filter((x) => x.kind === "stdout" && x.value.type === "control_request").map((x) => x.value);
  const responses = records
    .filter((x) => x.kind === "stdin" && x.value.type === "control_response")
    .map((x) => x.value);
  const responseFor = (req) => responses.filter((r) => r.response.request_id === req.request_id);
  const cancelled = (req) =>
    records.some(
      (x) => x.kind === "stdout" && x.value.type === "control_cancel_request" && x.value.request_id === req.request_id,
    );
  const permits = requests.filter((m) => m.request.subtype === "can_use_tool" && m.request.tool_name === "execute");
  assert.ok(permits.length >= 5, "Missing actual execute consent gates");
  assert.equal(responseFor(permits[0])[0]?.response.response?.behavior, "allow");
  assert.equal(responseFor(permits[1])[0]?.response.response?.behavior, "deny");
  assert.ok(cancelled(permits[2]), "Stop did not cancel the pending execute request");
  assert.ok(
    !responseFor(permits[2]).some((r) => r.response.response?.behavior === "allow"),
    "Stopped execute was approved",
  );
  const questions = requests.filter((m) => m.request.tool_name === "AskUserQuestion");
  assert.ok(questions.length >= 3, "Missing native saved question reopen gates");
  const selected = (r) => r.response.response?.updatedInput?.answers?.["Acceptance saved human question"];
  const answered = questions.filter((q) =>
    responseFor(q).some((r) => r.response.response?.behavior === "allow" && selected(r) === "Use local fixture"),
  );
  assert.equal(answered.length, 1, "Saved question must be answered exactly once");
  assert.ok(
    questions.some((q) =>
      responseFor(q).some(
        (r) => r.response.response?.behavior === "allow" && selected(r) === "Keep pending (do not answer)",
      ),
    ),
    "Missing explicit question decline",
  );
  assert.ok(questions.some(cancelled), "Missing interrupted question projection");
  for (const q of answered) {
    assert.equal(responseFor(q).length, 1, "Duplicate native human answer callback");
    assert.equal(
      responseFor(q)[0].response.response?.updatedInput?.answers?.["Acceptance saved human question"],
      "Use local fixture",
    );
  }
  return {
    permissionRequests: permits.length,
    questionRequests: questions.length,
    answeredQuestionCallbacks: answered.length,
  };
}
export async function verify({ wire: records, config, proof, t3Version, t3BinarySha256 }) {
  const checks = checkHumanWire(records);
  await capture({ records, config, proof });
  const observations = JSON.parse(await fs.readFile(path.join(proof, "human-observations.json"), "utf8"));
  await fs.writeFile(
    path.join(proof, "wire-projection.ndjson"),
    projectWire(records)
      .map((x) => JSON.stringify(x))
      .join("\n") + "\n",
  );
  await fs.writeFile(
    path.join(proof, "result.json"),
    JSON.stringify(
      {
        integratedAcceptance: true,
        focusedHumanControls: true,
        pendingConsentStop: "tested: cancellation and no side effect",
        staleApprovalAfterStop: observations.staleApprovalAfterStop,
        syntheticConnectorEvents: false,
        modelIdentity: modelSlug,
        testModelNotClaude: true,
        realCredentialsUsed: false,
        t3Version,
        t3BinarySha256,
        upstreamUnmodified: true,
        ...checks,
        gaps: [
          "Official T3 persists cancelled approval card; explicit human Decline required to continue",
          "task/Live/delegation/history gates belong to separate composed acceptance",
          "full browser tab disconnect not separately tested",
          "Official T3 zero-model human command can stay Working after success; actual Stop/reopen used for recovery",
        ],
      },
      null,
      2,
    ) + "\n",
  );
}

export async function capture({ records, config, proof }) {
  const requests = records.filter((x) => x.kind === "stdout" && x.value.type === "control_request").map((x) => x.value);
  const responses = records
    .filter((x) => x.kind === "stdin" && x.value.type === "control_response")
    .map((x) => x.value);
  const commands = records.filter(
    (x) =>
      x.kind === "stdin" &&
      x.value.type === "user" &&
      typeof x.value.message?.content === "string" &&
      x.value.message.content.startsWith("/bruv"),
  );
  await fs.writeFile(
    path.join(proof, "native-command-terminals.json"),
    JSON.stringify(
      commands.map((x) => ({
        sourceHash: typeof x.value.uuid === "string" ? hash(x.value.uuid) : null,
        echoedTerminalResults:
          typeof x.value.uuid === "string"
            ? records
                .filter(
                  (r) => r.kind === "stdout" && r.value.type === "result" && r.value.user_message_uuid === x.value.uuid,
                )
                .map((r) => ({ subtype: r.value.subtype, numTurns: r.value.num_turns }))
            : [],
      })),
      null,
      2,
    ) + "\n",
  );
  const correlation = requests.map((m) => ({
    requestHash: hash(m.request_id),
    toolUseHash: typeof m.request.tool_use_id === "string" ? hash(m.request.tool_use_id) : undefined,
    tool: m.request.tool_name,
    control: m.request.subtype,
    cancelled: records.some(
      (x) => x.kind === "stdout" && x.value.type === "control_cancel_request" && x.value.request_id === m.request_id,
    ),
    responses: responses
      .filter((r) => r.response.request_id === m.request_id)
      .map((r) => ({ subtype: r.response.subtype, behavior: r.response.response?.behavior })),
  }));
  await fs.writeFile(path.join(proof, "human-protocol-correlation.json"), JSON.stringify(correlation, null, 2) + "\n");
  await fs.writeFile(
    path.join(proof, "final-saved-ledger.json"),
    JSON.stringify((await ledger(config)).map(projected), null, 2) + "\n",
  );
}
