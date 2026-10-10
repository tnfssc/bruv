// Deterministic loopback inference only. Tools and goal transitions run in Bruv.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { modelId } from "./model.mjs";

export const objective = "NATIVE_GOAL_CONTROLS_ACCEPTANCE";
export const budgetObjective = "NATIVE_GOAL_BUDGET_ACCEPTANCE";
export const usage = { prompt_tokens: 16, completion_tokens: 7, total_tokens: 23 };
const counts = new Map();
const text = (message) =>
  typeof message.content === "string"
    ? message.content
    : (message.content ?? []).map((block) => block.text ?? "").join("\n");
const content = (value) => ({ role: "assistant", content: value });

async function gate(file, signal) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    if (
      await fs.access(file).then(
        () => true,
        () => false,
      )
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw Error(`Native driver did not release ${path.basename(file)}`);
}

export async function reply(body, { state, signal, emit }) {
  assert.equal(body.model, modelId, "explicit local test model identity");
  if (!body.tools?.length) return content("Local goal controls acceptance");
  const messages = body.messages ?? [];
  if (messages.some((message) => message.role === "user" && text(message).includes("NATIVE_GOAL_POST_COMPLETION")))
    return content("GOAL_POST_COMPLETION_REAL");
  const stateText = messages.map(text).findLast((value) => value.includes("Saved goal (current state):"));
  const selected = stateText?.includes(budgetObjective)
    ? budgetObjective
    : stateText?.includes(objective)
      ? objective
      : undefined;
  if (!selected) throw Error("Actual authoritative goal state did not reach the local model");
  const toolResult = messages
    .filter((message) => message.role === "tool")
    .map(text)
    .join("\n");
  if (toolResult.includes(`GOAL_COMPLETED_TOOL_REAL:${selected}`))
    return content(selected === objective ? "GOAL_COMPLETED_REAL" : "GOAL_BUDGET_COMPLETED_REAL");
  const key = `${state}:${selected}`;
  const number = (counts.get(key) ?? 0) + 1;
  counts.set(key, number);
  const name = selected === objective ? "goal" : "budget";
  await fs.writeFile(path.join(state, `${name}-${number}.started`), "actual provider request");
  const execute = (code) => ({
    role: "assistant",
    tool_calls: [
      {
        index: 0,
        id: `goal_acceptance_${body.__sequence}`,
        type: "function",
        function: { name: "execute", arguments: JSON.stringify({ label: "Verify actual goal controls", code }) },
      },
    ],
  });
  if (selected === objective) {
    if (number === 1) return content("GOAL_FIRST_UNFINISHED_REAL");
    if (number === 2) {
      emit?.(content("GOAL_SECOND_PENDING_REAL\n"));
      await gate(path.join(state, "unfinished.release"), signal);
      return content("GOAL_SECOND_UNFINISHED_REAL");
    }
    emit?.(content("GOAL_RESUMED_PENDING_REAL\n"));
    await gate(path.join(state, "complete.release"), signal);
  } else if (number === 1) {
    // The response exhausts the explicit budget. This tool must never execute.
    return execute(`await Bun.write(${JSON.stringify(path.join(state, "budget-forbidden.effect"))}, "wrong");`);
  }
  return execute(`
    const current = await goal.get();
    if (current.objective !== ${JSON.stringify(selected)} || current.status !== "active")
      throw Error("Goal ownership or active state was lost");
    const done = await goal.update({status:"completed", evidence:"Actual native acceptance execute verified the objective"});
    if (done.status !== "completed") throw Error("Goal completion was not persisted");
    console.log(${JSON.stringify(`GOAL_COMPLETED_TOOL_REAL:${selected}`)});
  `);
}

export function verifyModelOutcome(records) {
  for (const marker of [
    "GOAL_FIRST_UNFINISHED_REAL",
    "GOAL_COMPLETED_REAL",
    "GOAL_BUDGET_COMPLETED_REAL",
    "GOAL_POST_COMPLETION_REAL",
  ])
    assert.equal(records.filter((row) => row.delta?.content === marker).length, 1, `Exactly one ${marker}`);
  assert.ok(
    records.filter((row) => row.aborted).length >= 2,
    "Pause and native Stop each aborted a pending local request",
  );
  assert.equal(
    records.some((row) => row.error),
    false,
    "No local endpoint errors",
  );
}
