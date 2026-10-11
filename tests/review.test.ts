import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { registerReview } from "../src/review";
import { sdk } from "./sdk";

setDefaultTimeout(15000);
mkdirSync(".tmp", { recursive: true });
const dir = mkdtempSync(resolve(".tmp/review-"));
const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
git("init", "-qb", "feature");
git("config", "user.name", "Test");
git("config", "user.email", "test@example.com");
writeFileSync(join(dir, "file.txt"), "original\n");
git("add", ".");
git("commit", "-qm", "Start");
const base = git("rev-parse", "HEAD");
git("branch", "develop");
git("branch", "aaa");
git("update-ref", "refs/remotes/origin/develop", base);
git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop");
for (let i = 1; i <= 22; i++) git("commit", "--allow-empty", "-qm", `Change ${i}`);
writeFileSync(join(dir, "file.txt"), "staged\n");
git("add", ".");
writeFileSync(join(dir, "file.txt"), "unstaged\n");
writeFileSync(join(dir, "new.txt"), "untracked\n");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test.each([
  "uncommitted",
  "branch",
  "commit",
  "branch-arg",
  "commit-arg",
  "cancel",
  "cancel-branch",
  "cancel-commit",
  "invalid",
])("review handles %s and starts at most one RPC run", async (choice) => {
  const settled = Promise.withResolvers<void>();
  const picks: string[][] = [];
  const runs = { started: 0, settled: 0 };
  const messages: unknown[] = [];
  const app = await sdk(
    [
      (pi) => {
        const send = pi.sendUserMessage;
        pi.sendUserMessage = (content, options) => {
          messages.push(content);
          send(content, options);
        };
        registerReview(pi);
        pi.on("agent_start", () => {
          runs.started++;
        });
        pi.on("agent_settled", () => {
          runs.settled++;
          settled.resolve();
        });
      },
    ],
    {
      select: async (_title, options) => {
        picks.push(options);
        if (choice === "cancel" || (picks.length === 2 && choice.startsWith("cancel-"))) return undefined;
        if (picks.length === 1)
          return options[choice.includes("branch") ? 1 : choice === "commit" || choice === "cancel-commit" ? 2 : 0];
        return options[0];
      },
    },
    dir,
    "rpc",
  );
  const errors: unknown[] = [];
  app.session.extensionRunner.onError((error) => {
    errors.push(error);
  });
  const head = git("rev-parse", "HEAD");
  const index = readFileSync(join(dir, ".git/index"));
  try {
    app.faux.setResponses([fauxAssistantMessage("reviewed")]);
    const arg =
      choice === "branch-arg" ? "develop" : choice === "commit-arg" ? "HEAD~1" : choice === "invalid" ? "--help" : "";
    await app.session.prompt(`/review ${arg}`);
    if (choice.startsWith("cancel") || choice === "invalid") {
      expect(runs).toEqual({ started: 0, settled: 0 });
      expect(messages).toHaveLength(0);
      expect(errors).toHaveLength(choice === "invalid" ? 1 : 0);
    } else {
      await settled.promise;
      expect(errors).toEqual([]);
      expect(runs).toEqual({ started: 1, settled: 1 });
      expect(app.faux.state.callCount).toBe(1);
      expect(messages).toHaveLength(1);
      const user = app.session.messages.filter((message) => message.role === "user");
      expect(user).toHaveLength(1);
      expect(JSON.stringify(user[0])).toContain(JSON.stringify(messages[0]).slice(1, -1));
      if (choice.includes("branch")) expect(messages[0]).toContain(base);
      if (choice === "commit" || choice === "commit-arg")
        expect(messages[0]).toContain(choice === "commit" ? head : git("rev-parse", "HEAD~1"));
      if (choice.endsWith("-arg")) expect(picks).toHaveLength(0);
      if (choice === "branch") expect(picks[1]).toEqual(["develop", "aaa", "feature"]);
      if (choice === "commit") {
        expect(picks[1]).toHaveLength(20);
        expect(picks[1][0].startsWith(head.slice(0, 8))).toBe(true);
      }
    }
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(readFileSync(join(dir, ".git/index"))).toEqual(index);
    expect(readFileSync(join(dir, "file.txt"), "utf8")).toBe("unstaged\n");
    expect(readFileSync(join(dir, "new.txt"), "utf8")).toBe("untracked\n");
  } finally {
    await app.close();
  }
});
