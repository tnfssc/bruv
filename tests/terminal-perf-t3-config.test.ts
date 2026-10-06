import { expect, test } from "bun:test";
import { resolve } from "node:path";

type Script = { name: string; command: string; icon: string; async?: boolean; runOnWorktreeCreate?: boolean };

test("T3 benchmark actions are manual and use the package harness commands", async () => {
  const root = resolve(import.meta.dir, "..");
  const config = (await Bun.file(resolve(root, "t3.json")).json()) as { scripts: Script[] };
  const pkg = (await Bun.file(resolve(root, "package.json")).json()) as { scripts: Record<string, string> };
  for (const [name, command] of [
    ["Terminal Frame Lab", "perf:terminal"],
    ["Terminal Interaction Lab", "perf:interactions"],
  ]) {
    const matches = config.scripts.filter((script) => script.name === name);
    expect(matches).toHaveLength(1);
    const action = matches[0];
    expect(action.command).toBe(`bun run ${command}`);
    expect(pkg.scripts[command]).toBeTruthy();
    expect(action.runOnWorktreeCreate).not.toBe(true);
    expect(action.async).toBe(true);
  }
});
