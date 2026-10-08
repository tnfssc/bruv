import { expect, test } from "bun:test";
import { createHistoryFixture, runHistoryProcess } from "./history-process";

// Run each variant in a fresh process: the disk adapter patches the SDK prototype.
const scenario = String.raw`
const { existsSync, readFileSync } = await import("node:fs");
if (process.env.ADAPTER === "1") {
  const { installDiskBackedSessionManager } = await import("./src/history/session-manager.ts");
  installDiskBackedSessionManager();
}
const { SessionManager } = await import("@earendil-works/pi-coding-agent");
const manager = SessionManager.create(process.env.HISTORY_ROOT, process.env.HISTORY_ROOT);
const file = manager.getSessionFile();
const snapshots = [];
const snapshot = (stage) => snapshots.push({
  stage, exists: existsSync(manager.getSessionFile()),
  count: manager.getEntryCount(), entries: manager.getEntries().length,
  name: manager.getSessionName() ?? null,
  directName: manager.fileEntries.filter(e => e.type === "session_info").at(-1)?.name ?? null,
  leafType: manager.getLeafEntry()?.type ?? null,
});
snapshot("new");
manager.appendModelChange("provider", "model");
manager.appendThinkingLevelChange("high");
manager.appendSessionInfo("  First name  ");
snapshot("setup");
manager.appendSessionInfo("   ");
snapshot("cleared");
const first = manager.appendMessage({ role: "user", content: "persist without response", timestamp: 1 });
snapshot("user");
const diskAfterUser = readFileSync(file, "utf8").trim().split("\n").map(line => JSON.parse(line).type);
manager.appendSessionInfo("Second name");
snapshot("renamed");
const reopened = SessionManager.open(file, process.env.HISTORY_ROOT);
const reopenedState = {
  name: reopened.getSessionName(), count: reopened.getEntryCount(), entries: reopened.getEntries().length,
  leafIsName: reopened.getLeafEntry()?.type === "session_info",
  directName: reopened.fileEntries.filter(e => e.type === "session_info").at(-1)?.name,
};
const userOnlyBranchFile = reopened.createBranchedSession(first);
const userOnlyBranch = { exists: existsSync(userOnlyBranchFile), count: reopened.getEntryCount(), types: readFileSync(userOnlyBranchFile, "utf8").trim().split("\n").map(line => JSON.parse(line).type) };
manager.branch(first);
manager.appendMessage({ role: "user", content: "alternate", timestamp: 2 });
snapshot("branch");
manager.newSession();
snapshot("new session");
console.log(JSON.stringify({ snapshots, diskAfterUser, reopenedState, userOnlyBranch }));
`;

async function run(root: string, adapted: boolean) {
  const { stdout, stderr, code } = await runHistoryProcess(root, ["-e", scenario], { ADAPTER: adapted ? "1" : "0" });
  expect(code, stderr).toBe(0);
  return JSON.parse(stdout.trim().split("\n").at(-1)!);
}

test("Pi 1.0.0: first-user publication, direct session name and O(1) entry count match native SDK", async () => {
  const nativeRoot = await createHistoryFixture("pi-099-native-");
  const adaptedRoot = await createHistoryFixture("pi-099-adapted-");
  const [native, adapted] = await Promise.all([run(nativeRoot, false), run(adaptedRoot, true)]);
  expect(adapted).toEqual(native);
  expect(
    adapted.snapshots.map(({ stage, exists, count }: { stage: string; exists: boolean; count: number }) => ({
      stage,
      exists,
      count,
    })),
  ).toEqual([
    { stage: "new", exists: false, count: 0 },
    { stage: "setup", exists: false, count: 3 },
    { stage: "cleared", exists: false, count: 4 },
    { stage: "user", exists: true, count: 5 },
    { stage: "renamed", exists: true, count: 6 },
    { stage: "branch", exists: true, count: 7 },
    { stage: "new session", exists: false, count: 0 },
  ]);
  expect(adapted.diskAfterUser).toEqual([
    "session",
    "model_change",
    "thinking_level_change",
    "session_info",
    "session_info",
    "message",
  ]);
  expect(adapted.userOnlyBranch).toEqual({
    exists: true,
    count: 5,
    types: ["session", "model_change", "thinking_level_change", "session_info", "session_info", "message"],
  });
  expect(adapted.reopenedState).toEqual({
    name: "Second name",
    count: 6,
    entries: 6,
    leafIsName: true,
    directName: "Second name",
  });
}, 30_000);
