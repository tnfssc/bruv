/** Deterministic presentation inference; diagnostics are stored only by the transport. */
export type RequestBody = {
  model: string;
  messages?: Array<{ role: string; content?: unknown; tool_call_id?: string }>;
};
export const ALIAS = "studio";
export const ANSWER = "Keep it concise";
export const QUESTION = "How detailed should the getting-started notes be?";
const called = (body: RequestBody, id: string) =>
  (body.messages ?? []).some((m) => m.role === "tool" && m.tool_call_id === id);
const userHas = (body: RequestBody, text: string) =>
  (body.messages ?? []).some((m) => m.role === "user" && JSON.stringify(m.content).includes(text));
const say = (content: string) => ({ role: "assistant", content });
const execute = (id: string, label: string, code: string) => ({
  role: "assistant",
  tool_calls: [
    { index: 0, id, type: "function", function: { name: "execute", arguments: JSON.stringify({ label, code }) } },
  ],
});
export function response(body: RequestBody): object {
  if (body.model === "helper") {
    if (!called(body, "read-guide"))
      return execute(
        "read-guide",
        "Read the project guide",
        'await Bun.sleep(2000); const guide = await Bun.file("README.md").text(); console.log(guide);',
      );
    return say("The guide needs three steps: install, run, and open the local app. Keep the introduction short.");
  }
  if (userHas(body, ANSWER)) {
    if (!called(body, "write-notes"))
      return execute(
        "write-notes",
        "Write getting-started notes",
        `const list = await questions.list();
const q = list.find(q => q.text === ${JSON.stringify(QUESTION)});
await questions.resolve({
  id: q.id,
  owner: q.owner,
  version: q.version,
  reason: "Used your preference",
});
await Bun.write("NOTES.md", ${JSON.stringify(
          "# Getting started\n\n1. Install dependencies.\n2. Run the development server.\n3. Open the local app.\n",
        )});`,
      );
    const result = (body.messages ?? []).filter((m) => m.role === "tool" && m.tool_call_id === "write-notes").at(-1);
    if (JSON.stringify(result?.content).includes("Execution failed"))
      throw Error("Notes write failed; no success response may be emitted");
    return say(
      [
        "Added concise getting-started notes in NOTES.md.",
        "",
        "The helper reviewed README.md in its own server worktree.",
        "Used your choice: keep it concise. The saved question is resolved.",
        "Use /close to return the notes safely to your local project.",
      ].join("\n"),
    );
  }
  if (!called(body, "review-guide"))
    return execute(
      "review-guide",
      "Ask a helper to review the guide",
      'await subagent({type:"normal", title:"Review the project guide", waitSeconds:0, prompt:"Read README.md and suggest a short getting-started outline.", workspace:{kind:"worktree"}});',
    );
  if (!called(body, "ask-detail"))
    return execute(
      "ask-detail",
      "Ask about the level of detail",
      `const q = await questions.ask({
  text: ${JSON.stringify(QUESTION)},
  choices: [${JSON.stringify(ANSWER)}, "Add more detail"],
  allowFreeText: false,
});
await questions.block({
  id: q.id,
  owner: q.owner,
  version: q.version,
  checkpoint: "Write the getting-started notes",
  foreground: true,
});`,
    );
  return say(
    "The helper is reviewing the guide. I saved a question about the level of detail; you can answer it in /questions.",
  );
}
export function stream(body: RequestBody): string {
  const delta = response(body);
  const emit = (delta: object, finish_reason: string | null) => ({
    id: "demo",
    object: "chat.completion.chunk",
    created: 1,
    model: body.model,
    choices: [{ index: 0, delta, finish_reason }],
  });
  return `${[emit(delta, null), emit({}, "tool_calls" in delta ? "tool_calls" : "stop")]
    .map((e) => `data: ${JSON.stringify(e)}\n\n`)
    .join("")}data: [DONE]\n\n`;
}
