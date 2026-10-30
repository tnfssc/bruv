import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSharedAgents, sharedAgents } from "../src/shared-agents";
import { sdk } from "./sdk";

function home() {
  mkdirSync(".tmp", { recursive: true });
  const dir = mkdtempSync(resolve(".tmp/shared-agents-"));
  mkdirSync(join(dir, ".agents"));
  writeFileSync(join(dir, ".agents", "AGENTS.md"), "shared-rule-318");
  return dir;
}

test("~/.agents/AGENTS.md comes before project context files", async () => {
  const dir = home();
  const app = await sdk([(pi: ExtensionAPI) => registerSharedAgents(pi, dir)], undefined, undefined, "rpc", [
    { path: "/project/AGENTS.md", content: "project-rule-552" },
  ]);
  app.faux.setResponses([
    (context) => {
      const text = JSON.stringify(context.messages.find((message) => message.role === "system"));
      expect(text.indexOf("shared-rule-318")).toBeGreaterThan(-1);
      expect(text.indexOf("shared-rule-318")).toBeLessThan(text.indexOf("project-rule-552"));
      return fauxAssistantMessage("done");
    },
  ]);
  await app.session.prompt("go");
  expect(app.session.getLastAssistantText()).toBe("done");
});

test("skips the file when Pi already loaded it through a link", () => {
  const dir = home();
  const pi = join(dir, "pi-AGENTS.md");
  symlinkSync(join(dir, ".agents", "AGENTS.md"), pi);
  expect(sharedAgents([{ path: pi, content: "shared-rule-318" }], dir)).toBeUndefined();
  expect(sharedAgents([], dir)?.content).toBe("shared-rule-318");
  expect(sharedAgents([], join(dir, "missing"))).toBeUndefined();
});
