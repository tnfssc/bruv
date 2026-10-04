import { expect, test } from "bun:test";
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

test("native test tap and shell fixture use Node outside /usr/bin", async () => {
  const installed = Bun.which("node");
  if (!installed) throw new Error("Node is required for native gate tests");
  const root = await mkdtemp(path.join(tmpdir(), "bruv-node-path-"));
  try {
    const node = path.join(root, "node");
    await copyFile(installed, node);
    await chmod(node, 0o755);
    const tap = path.join(root, "connector-tap");
    await copyFile(new URL("../scripts/claude-native-acceptance/tap.mjs", import.meta.url), tap);
    await chmod(tap, 0o755);
    const config = path.join(root, "config.json");
    await writeFile(
      config,
      JSON.stringify({
        wire: path.join(root, "wire.ndjson"),
        connector: node,
        connectorArgs: ["-e", "process.stdout.write(JSON.stringify({node:process.execPath})+'\\n')"],
      }),
    );
    const env = { PATH: [root, "/usr/bin", "/bin"].join(path.delimiter), BRUV_ACCEPTANCE_CONFIG: config };
    const proc = Bun.spawn([tap], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [output, error, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect({ code, error }).toEqual({ code: 0, error: "" });
    expect(JSON.parse(output).node).toBe(node);
    const model = pathToFileURL(path.resolve("scripts/claude-native-acceptance/model.mjs")).href;
    const source =
      "import {reply,modelId} from " +
      JSON.stringify(model) +
      "; console.log(JSON.stringify(reply({model:modelId,messages:[{role:'user',content:'ACCEPT_EARLY_RETURN'}]},{worker:'/fixture/worker.mjs',state:'/fixture/state'})));";
    const fixture = Bun.spawn([node, "--input-type=module", "-e", source], { env, stdout: "pipe", stderr: "pipe" });
    const text = await new Response(fixture.stdout).text();
    expect(await fixture.exited).toBe(0);
    const tool = JSON.parse(text).tool_calls[0];
    expect(JSON.parse(tool.function.arguments).code).toContain(node);
    expect(await readFile(path.join(root, "wire.ndjson"), "utf8")).toContain('"kind":"stdout"');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
