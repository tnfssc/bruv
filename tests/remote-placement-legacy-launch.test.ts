import { expect, test } from "bun:test";
import { createRemoteOperations } from "../src/remote/operations";

test("legacy agent launches cannot bypass normal delegation policy or start a second task lifecycle", async () => {
  let launches = 0;
  const operations = createRemoteOperations({ launch: async () => { launches++; throw Error("must not launch"); } } as any);
  await expect(operations({op:"launch",repoPath:"/repo",prompt:"bypass"})).rejects.toThrow("subagent");
  await expect(operations({op:"launchRepository",prompt:"bypass"})).rejects.toThrow("subagent");
  expect(launches).toBe(0);
});
