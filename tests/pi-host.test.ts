import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  DefaultPackageManager,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai/compat";
import { builtInExtensions } from "../node_modules/@earendil-works/pi-coding-agent/dist/extensions/index.js";
import { adaptPiHostFile, piHostPatches, preparePiHost } from "../scripts/pi-host-adaptation";
import { assertBruvPiHost } from "../src/pi-host";
import tasks from "../src/agent/extension";
import { offlineTestEnv, run } from "./helpers";

const root = resolve(import.meta.dir, "..");
const piRoot = join(root, "node_modules/@earendil-works/pi-coding-agent");
const removed = ["mcp", "codemode", "tool-search"];
const dirs: string[] = [];
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), "bruv-pi-host-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

// The small upstream registry fixture also proves the patch removes imports,
// not only visibility or activation of their registered tools.
const originalRegistry =
  'import codemodeExtension from "./codemode/index.js";\nimport llamaExtension from "./llama/index.js";\nimport mcpExtension from "./mcp/index.js";\nimport toolSearchExtension from "./tool-search/index.js";\nexport const builtInExtensions = [\n    { name: "llama.cpp", factory: llamaExtension, builtin: true },\n    // Replaceable: an extension that registers `codemode`, `tool_search`, or `/mcp` (such as a third-party\n    // MCP extension) takes over instead of running alongside the built-in one.\n    { name: "codemode", factory: codemodeExtension, replaceable: true, builtin: true },\n    { name: "tool-search", factory: toolSearchExtension, replaceable: true, builtin: true },\n    { name: "mcp", factory: mcpExtension, replaceable: true, builtin: true },\n];\n//# sourceMappingURL=index.js.map';

test("Pi host adaptations include the required disk-backed history seam", () => {
  expect(piHostPatches.some((patch) => patch.path === "dist/core/session-manager.js")).toBe(true);
});

test("Pi host adaptation is exact, idempotent, and rejects dependency drift", async () => {
  for (const patch of piHostPatches) {
    const installed = await readFile(join(piRoot, patch.path), "utf8");
    let original = installed;
    if (digest(installed) === patch.adaptedSha256) {
      original = patch.content
        ? originalRegistry
        : (patch.replacements ?? []).reduceRight((text, [before, after]) => {
            // The removed main import is restored at its original adjacent seam.
            if (after === "" && patch.path === "dist/main.js")
              return text.replace(
                'import { builtInExtensions } from "./extensions/index.js";\n',
                'import { builtInExtensions } from "./extensions/index.js";\n' + before,
              );
            if (after === "")
              return text.replace(`  \${APP_NAME} <command> --help`, before + `  \${APP_NAME} <command> --help`);
            return text.replace(after, before);
          }, installed);
    }
    expect(digest(original)).toBe(patch.originalSha256);
    const adapted = adaptPiHostFile(patch, original);
    expect(digest(adapted)).toBe(patch.adaptedSha256);
    expect(adaptPiHostFile(patch, adapted)).toBe(adapted);
    expect(() => adaptPiHostFile(patch, original + "\n// drift")).toThrow("Unsupported Pi host file");
  }
  assertBruvPiHost();
  const ready = {
    mainPrepared: true,
    argsPrepared: true,
    viewportPrepared: true,
    builtInNames: ["llama.cpp"],
    inputIdentityPrepared: true,
  };
  expect(() => assertBruvPiHost(ready)).not.toThrow();
  expect(() => assertBruvPiHost({ ...ready, inputIdentityPrepared: false })).toThrow("Pi host is not prepared");
  expect(builtInExtensions.map((extension) => extension.name)).toEqual(["llama.cpp"]);
});

test("runtime host gate rejects pristine and partly prepared dependencies", () => {
  for (const state of [
    { mainPrepared: true, argsPrepared: true, viewportPrepared: false, builtInNames: ["llama.cpp"] },
    { mainPrepared: false, argsPrepared: false, builtInNames: ["llama.cpp", ...removed] },
    { mainPrepared: true, argsPrepared: false, viewportPrepared: true, builtInNames: ["llama.cpp"] },
    { mainPrepared: false, argsPrepared: true, viewportPrepared: true, builtInNames: ["llama.cpp"] },
    { mainPrepared: true, argsPrepared: true, viewportPrepared: true, builtInNames: ["llama.cpp", "mcp"] },
  ])
    expect(() => assertBruvPiHost({ ...state, inputIdentityPrepared: true })).toThrow(
      "Pi host is not prepared for bruv",
    );
});

test("adaptation validates all files and version before any writes", async () => {
  const dir = await temp();
  await writeFile(join(dir, "package.json"), JSON.stringify({ version: "1.0.3" }));
  for (const patch of piHostPatches) {
    await mkdir(dirname(join(dir, patch.path)), { recursive: true });
    await writeFile(join(dir, patch.path), patch.content ? originalRegistry : await readFile(join(piRoot, patch.path)));
  }
  await writeFile(join(dir, piHostPatches[2]!.path), "drift");
  await expect(preparePiHost(dir)).rejects.toThrow("Unsupported Pi host file");
  expect(await readFile(join(dir, piHostPatches[0]!.path), "utf8")).toBe(originalRegistry);
  // The newly added viewport adaptation must also validate before the registry write.
  await writeFile(join(dir, piHostPatches[2]!.path), await readFile(join(piRoot, piHostPatches[2]!.path)));
  const viewportPatch = piHostPatches.find((patch) => patch.path === "dist/modes/interactive/chat-viewport.js")!;
  await writeFile(join(dir, viewportPatch.path), "viewport drift");
  await expect(preparePiHost(dir)).rejects.toThrow("Unsupported Pi host file");
  expect(await readFile(join(dir, piHostPatches[0]!.path), "utf8")).toBe(originalRegistry);
  await writeFile(join(dir, "package.json"), JSON.stringify({ version: "1.0.2" }));
  await expect(preparePiHost(dir)).rejects.toThrow("Unsupported Pi host version");
});

test("trusted project overrides and explicit built-in selectors cannot restore removed factories; config retains llama", async () => {
  const dir = await temp();
  const agentDir = join(dir, "agent");
  await mkdir(agentDir);
  await mkdir(join(dir, ".pi"));
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({ extensions: removed.map((name) => "-builtin:" + name) }),
  );
  await writeFile(
    join(dir, ".pi/settings.json"),
    JSON.stringify({ extensions: removed.map((name) => "+builtin:" + name) }),
  );
  const settingsManager = SettingsManager.create(dir, agentDir, { projectTrusted: true });
  const factories = builtInExtensions;
  const config = await new DefaultPackageManager({
    cwd: dir,
    agentDir,
    settingsManager,
    builtinExtensions: factories.map((extension) => extension.name ?? ""),
  }).resolve();
  expect(config.extensions.filter((item) => item.path.startsWith("builtin:")).map((item) => item.path)).toEqual([
    "builtin:llama.cpp",
  ]);
  for (const name of removed) {
    const loader = new DefaultResourceLoader({
      cwd: dir,
      agentDir,
      settingsManager,
      extensionFactories: factories,
      additionalExtensionPaths: ["builtin:" + name],
    });
    await loader.reload();
    expect(loader.getExtensions().errors).toContainEqual({
      path: "builtin:" + name,
      error: "Unknown built-in extension: builtin:" + name,
    });
    expect(loader.getExtensions().extensions.map((extension) => extension.path)).not.toContain("builtin:" + name);
    const fromSettings = new DefaultResourceLoader({
      cwd: dir,
      agentDir,
      extensionFactories: factories,
      settingsManager: SettingsManager.inMemory({ extensions: ["builtin:" + name] }, { projectTrusted: true }),
    });
    await fromSettings.reload();
    // Settings entries are override selectors, not a way to create factories.
    expect(fromSettings.getExtensions().extensions.map((extension) => extension.path)).not.toContain("builtin:" + name);
  }
});

for (const entry of ["source", "compiled"] as const) {
  const command = entry === "source" ? [process.execPath, join(root, "src/cli.ts")] : [join(root, "dist/bruv")];
  test(entry + " CLI removes MCP command/help and rejects all explicit removed built-ins", async () => {
    const home = await temp();
    const env = { HOME: home, PATH: process.env.PATH, PI_OFFLINE: "1", HERDR_ENV: "0" };
    const help = await run([...command, "--help"], { cwd: home, env });
    expect(help.code).toBe(0);
    expect(help.stdout).not.toContain("mcp");
    expect(help.stdout).not.toContain("codemode");
    expect(help.stdout).not.toContain("tool-search");
    expect(help.stdout).toContain("TUI mode: fullscreen (default) or regular");
    const providerOnly = await run([...command, "--offline", "-p", "--no-session", "--provider", "openai"], {
      cwd: home,
      env,
    });
    expect(providerOnly.code).toBe(1);
    expect(providerOnly.stderr).toContain("--provider requires --model");
    const configHelp = await run([...command, "config", "--help"], { cwd: home, env });
    expect(configHelp.code).toBe(0);
    expect(configHelp.stdout).toContain("config");
    expect(configHelp.stderr).not.toContain("Unknown option");
    for (const args of [
      ["mcp", "--help"],
      ["mcp", "list"],
      ["mcp", "login", "sentinel"],
    ]) {
      const result = await run([...command, ...args], { cwd: home, env });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("MCP is not a built-in bruv command");
    }
    for (const name of removed) {
      const result = await run([...command, "--offline", "-p", "--no-session", "-e", "builtin:" + name, "fixture"], {
        cwd: home,
        env,
      });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Unknown built-in extension: builtin:" + name);
    }
  }, 20_000);

  test(entry + " CLI starts no configured MCP server and preserves user extension registration", async () => {
    const home = await temp();
    const agentDir = join(home, ".bruv/agent");
    await mkdir(agentDir, { recursive: true });
    const marker = join(home, "mcp-started");
    const proof = join(home, "proof.json");
    const config = JSON.stringify({
      autoEnableCodemode: true,
      mcpServers: {
        sentinel: {
          command: process.execPath,
          args: ["-e", "Bun.write(" + JSON.stringify(marker) + ", 'started');"],
          exposure: "codemode-deferred",
        },
      },
    });
    await writeFile(join(agentDir, "mcp.json"), config);
    const projectConfig = config.replace('"sentinel":', '"project_sentinel":');
    await writeFile(join(home, ".bruv/mcp.json"), projectConfig);
    await writeFile(
      join(agentDir, "auth.json"),
      JSON.stringify({ openai: { type: "api_key", key: "offline-fixture" } }),
    );
    const extension = join(home, "fixture.js");
    await writeFile(
      extension,
      'export default function(pi) { pi.registerTool({name:"user_fixture",label:"Fixture",description:"Fixture",parameters:{type:"object",properties:{}},async execute(){return {content:[{type:"text",text:"fixture"}]};}}); pi.on("session_start",async()=>{await Bun.write(' +
        JSON.stringify(proof) +
        ",JSON.stringify({tools:pi.getAllTools().map(t=>t.name),commands:pi.getCommands().map(c=>c.name)}));}); }",
    );
    const proc = Bun.spawn(
      [
        ...command,
        "--offline",
        "--approve",
        "--mode",
        "rpc",
        "--no-session",
        "--provider",
        "openai",
        "--model",
        "gpt-4o",
        "-e",
        extension,
      ],
      {
        cwd: home,
        env: offlineTestEnv({ HOME: home, PATH: process.env.PATH }),
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stderr = new Response(proc.stderr).text();
    try {
      // get_state is processed after RPC binds extensions and awaits session_start.
      proc.stdin.write(JSON.stringify({ id: "ready", type: "get_state" }) + "\n");
      const reader = proc.stdout.getReader();
      let output = "";
      const deadline = setTimeout(() => proc.kill(), 10_000);
      try {
        while (!output.includes('"id":"ready"')) {
          const chunk = await reader.read();
          if (chunk.done) break;
          output += new TextDecoder().decode(chunk.value);
        }
      } finally {
        clearTimeout(deadline);
        reader.releaseLock();
      }
      expect(output).toContain('"id":"ready"');
      const observed = JSON.parse(await readFile(proof, "utf8"));
      expect(observed.tools).toContain("execute");
      expect(observed.tools).toContain("user_fixture");
      expect(observed.tools).not.toContain("codemode");
      expect(observed.tools).not.toContain("tool_search");
      expect(observed.commands).not.toContain("mcp");
      // Allow enough time for the old extension's asynchronous connect to run.
      await Bun.sleep(250);
      expect(await Bun.file(marker).exists()).toBe(false);
      expect(await readFile(join(agentDir, "mcp.json"), "utf8")).toBe(config);
      expect(await readFile(join(home, ".bruv/mcp.json"), "utf8")).toBe(projectConfig);
    } finally {
      proc.kill();
      await proc.exited;
      await stderr;
    }
  }, 15_000);
}

test("bruv execute stays active and user-authored codemode tools are not banned", async () => {
  const dir = await temp();
  const runtime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  runtime.hasConfiguredAuth = () => true;
  const loader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    noExtensions: true,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    extensionFactories: [
      ...builtInExtensions,
      { name: "bruv-tools", factory: tasks },
      {
        name: "user-code",
        factory: (pi) => {
          pi.registerTool({
            name: "codemode",
            label: "User code",
            description: "User-owned fixture",
            parameters: { type: "object", properties: {} } as any,
            async execute() {
              return { content: [{ type: "text", text: "user-owned" }], details: {} };
            },
          });
        },
      },
    ],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    resourceLoader: loader,
    model: getModel("openai", "gpt-4o"),
    modelRuntime: runtime,
    sessionManager: SessionManager.inMemory(dir),
  });
  try {
    await session.bindExtensions({ mode: "print" });
    expect(session.getActiveToolNames()).toEqual(["execute"]);
    expect(session.getAllTools().map((tool) => tool.name)).toContain("codemode");
    session.setActiveToolsByName(["execute", "codemode"]);
    expect(session.getActiveToolNames()).toEqual(["execute", "codemode"]);
  } finally {
    session.dispose();
  }
});

test("upstream defaults to fullscreen and honors explicit regular mode", () => {
  expect(SettingsManager.inMemory().getTuiMode()).toBe("fullscreen");
  expect(SettingsManager.inMemory({ tuiMode: "fullscreen" }).getTuiMode()).toBe("fullscreen");
  expect(SettingsManager.inMemory({ tuiMode: "regular" }).getTuiMode()).toBe("regular");
  const manager = SettingsManager.inMemory();
  manager.applyOverrides({ tuiMode: "regular" });
  expect(manager.getTuiMode()).toBe("regular");
});
