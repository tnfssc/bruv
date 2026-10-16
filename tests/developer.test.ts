import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { registerDeveloper } from "../src/developer";
import { sdk } from "./sdk";

const input = (text: string) => ({ role: "user", content: [{ type: "input_text", text }] });
const custom = (customType: string, content: string) =>
  ({ role: "custom", customType, content, display: false, timestamp: 0 }) as const;

test("the time is sent once per hour of session time", async () => {
  const app = await sdk([registerDeveloper]);
  try {
    app.faux.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
    await app.session.prompt("first");
    await app.session.prompt("second");
    const times = app.session.sessionManager
      .getEntries()
      .filter((entry) => entry.type === "custom_message" && entry.customType === "bruv-time");
    expect(times).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test("bruv's own messages go to Responses models as developer messages", async () => {
  const app = await sdk([registerDeveloper]);
  try {
    const runner = app.session.extensionRunner;
    await runner.emitContext([
      custom("bruv-report", "j1 done"),
      custom("bruv-answer", "yes please"),
      { role: "user", content: "hello", timestamp: 0 },
    ]);
    const payload = { input: [input("hello"), input("j1 done"), input("yes please")] };
    expect(await runner.emitBeforeProviderRequest(structuredClone(payload))).toEqual(payload);
    await app.session.setModel({ ...app.faux.getModel(), api: "openai-codex-responses" });
    expect(await runner.emitBeforeProviderRequest(structuredClone(payload))).toEqual({
      input: [input("hello"), { ...input("j1 done"), role: "developer" }, input("yes please")],
    });
  } finally {
    await app.close();
  }
});
