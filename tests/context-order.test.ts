import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerContextOrder, render, scope } from "../src/context-order";
import { sdk } from "./sdk";

function tree() {
  mkdirSync(".tmp", { recursive: true });
  const top = mkdtempSync(resolve(".tmp/context-order-"));
  const home = join(top, "home");
  const agentDir = join(home, ".pi", "agent");
  const repo = join(home, "code", "app");
  const cwd = join(repo, "web");
  for (const dir of [agentDir, join(home, ".agents"), join(repo, ".git"), cwd]) mkdirSync(dir, { recursive: true });
  return { home, agentDir, repo, cwd };
}

test("each context file gets the scope of its folder", () => {
  const { home, agentDir, repo, cwd } = tree();
  const of = (dir: string) => scope(join(dir, "AGENTS.md"), cwd, agentDir, home);
  expect(of(agentDir)).toBe("global");
  expect(of(join(home, ".agents"))).toBe("global");
  expect(of(home)).toBe("parent");
  expect(of(join(home, "code"))).toBe("parent");
  expect(of(repo)).toBe("project");
  expect(of(cwd)).toBe("folder");
});

test("files are listed broadest first, each once", () => {
  const { home, agentDir, repo, cwd } = tree();
  const files = [
    { path: join(agentDir, "AGENTS.md"), content: "a" },
    { path: join(home, "code", "AGENTS.md"), content: "b" },
    { path: join(repo, "AGENTS.md"), content: "c" },
    { path: join(cwd, "AGENTS.md"), content: "d" },
    { path: join(home, ".agents", "AGENTS.md"), content: "e" },
  ];
  const scopes = [...render(files, cwd, agentDir, home).matchAll(/scope="(\w+)"/g)].map((match) => match[1]);
  expect(scopes).toEqual(["global", "global", "parent", "project", "folder"]);
});

test("the scoped list replaces Pi's own context section", async () => {
  const { repo, cwd } = tree();
  const app = await sdk([(pi: ExtensionAPI) => registerContextOrder(pi)], undefined, cwd, "rpc", [
    { path: join(repo, "AGENTS.md"), content: "project-rule-617" },
    { path: join(cwd, "AGENTS.md"), content: "folder-rule-204" },
  ]);
  app.faux.setResponses([
    (context) => {
      const system = context.messages.find((message) => message.role === "system");
      const text = JSON.stringify(system);
      expect(text.split("project-rule-617")).toHaveLength(2);
      expect(system?.sections?.project_context).toContain('scope="folder"');
      expect(text.indexOf("project-rule-617")).toBeLessThan(text.indexOf("folder-rule-204"));
      return fauxAssistantMessage("done");
    },
  ]);
  await app.session.prompt("go");
  expect(app.session.getLastAssistantText()).toBe("done");
});
