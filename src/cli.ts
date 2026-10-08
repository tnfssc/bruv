#!/usr/bin/env bun

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import bruvPackage from "../package.json";
import assetImage from "../dist/runtime-assets/assets/clankolas.png" with { type: "file" };
import exportTemplate from "../dist/runtime-assets/export-html/template.html" with { type: "file" };
import highlight from "../dist/runtime-assets/export-html/vendor/highlight.min.js" with { type: "file" };
import marked from "../dist/runtime-assets/export-html/vendor/marked.min.js" with { type: "file" };
import metadata from "../dist/runtime-assets/package.json" with { type: "file" };
import themeDark from "../dist/runtime-assets/theme/dark.json" with { type: "file" };
import themeLight from "../dist/runtime-assets/theme/light.json" with { type: "file" };
import themeSchema from "../dist/runtime-assets/theme/theme-schema.json" with { type: "file" };
import { withBruvSystemPrompt } from "./system-prompt";
import { formatThrownValue } from "./typescript/error-diagnostic";
import { INTERNAL_TYPESCRIPT_RUNNER_ARG, runTypeScriptFromStdin } from "./typescript/runner";
import { isCompiledInvocation, updateBruv } from "./update";

const cliArgs = process.argv.slice(2);
// The thin connector launcher enters here as `bruv claude-compat update`.
// Use the normal paired updater in this executable, never a PATH command or SDK updater.
if (cliArgs[0] === "claude-compat" && cliArgs[1] === "update") cliArgs.shift();
// Enter the connector before normal CLI bootstrap. Child work still starts this
// executable without the subcommand and uses the ordinary CLI path.
if (cliArgs[0] === "claude-compat") {
  // This entry is already the normal binary, even under a release target name.
  // Preserve explicit overrides; source Bun entrypoints still use connector defaults.
  if (isCompiledInvocation()) process.env.BRUV_CLAUDE_COMPAT_BRUV_PATH ??= process.execPath;
  const { runConnector } = await import("./claude-compat/cli");
  process.exit(await runConnector(cliArgs.slice(1)));
}

// Hidden offline transport diagnostic. No normal CLI path reaches this branch.
if (cliArgs[0] === "--offline-openai-transport-probe") {
  if (cliArgs.length !== 1 || process.env.BRUV_OFFLINE_OPENAI_TRANSPORT_PROBE !== "loopback-fake-key") {
    console.error("Offline OpenAI transport probe requires its explicit loopback test gate.");
    process.exit(1);
  }
  const { probeOpenAITransport } = await import("./live/offline-transport-probe");
  await probeOpenAITransport();
  process.exit(0);
}
if (cliArgs[0] === "--live-self-test") {
  if (cliArgs.length !== 1) throw new Error("Usage: bruv --live-self-test");
  const { testEmbeddedNativeHelper } = await import("./live/self-test");
  await testEmbeddedNativeHelper();
  process.exit(0);
}
if (cliArgs[0] === "update") {
  if (cliArgs.length === 2 && ["--help", "-h"].includes(cliArgs[1]!)) {
    console.log(
      "Usage: bruv update [--check]\n\nUpdate normal bruv and sibling bruv-claude-compat together after SHA256 and version checks.\nA compatible normal-only install gains the connector. --check reports without downloading or replacing files.\nStop active Bruv/T3 sessions first. Does not install Claude or T3; user data is unchanged.\nAliases: bruv-claude-compat update, bruv claude-compat update (same arguments).\nRestart T3 after updating. The connector CLI identity is unknown to Claude version checks; a separate built-in Claude model too-old advisory can remain.",
    );
    process.exit(0);
  }
  if (cliArgs.length !== 1 && !(cliArgs.length === 2 && cliArgs[1] === "--check")) {
    console.error("Usage: bruv update [--check]");
    process.exit(1);
  }
  try {
    console.log("Checking for Bruv pair updates...");
    const result = await updateBruv({
      currentVersion: bruvPackage.version,
      check: cliArgs[1] === "--check",
      onDownload: (version) => console.log("Downloading bruv and bruv-claude-compat " + version + "..."),
    });
    console.log(
      result.status === "updated"
        ? "Updated bruv and bruv-claude-compat to " + result.version + ". Restart Bruv/T3 sessions."
        : result.status === "available"
          ? "Bruv pair update/repair available (" + result.version + "). Run bruv update to install both."
          : result.status === "current"
            ? "bruv and bruv-claude-compat are current (" + result.version + ")"
            : "bruv and bruv-claude-compat are newer than the latest release (" + result.version + ")",
    );
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
if (cliArgs[0] === "web") {
  const { runWeb } = await import("./t3/web/launcher");
  process.exit(await runWeb(cliArgs.slice(1)));
}
if (cliArgs[0] === INTERNAL_TYPESCRIPT_RUNNER_ARG) {
  try {
    await runTypeScriptFromStdin();
    process.exit(0);
  } catch (error) {
    const diagnostic = formatThrownValue(error);
    console.error(diagnostic.replaceAll(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, "<execute-module>"));
    process.exit(1);
  }
}
const removedToolOptions = new Set([
  "--no-tools",
  "-nt",
  "--no-builtin-tools",
  "-nbt",
  "--tools",
  "-t",
  "--exclude-tools",
  "-xt",
]);
for (const argument of cliArgs) {
  if (argument === "--") break;
  const option = argument.split("=", 1)[0];
  if (removedToolOptions.has(option)) {
    console.error(`${option} is not supported by bruv; its core tool set is fixed by the current product phase.`);
    process.exit(1);
  }
}

await configureBruvRuntime();

// SSH stdio control and detached Linux task owners are internal production
// entry points. They do not start a local conversation or a public listener.
if (cliArgs[0] === "--remote-control" || cliArgs[0] === "--remote-owner") {
  const { runRemoteControl, runRemoteOwner } = await import("./remote/entry");
  try {
    if (cliArgs[0] === "--remote-control") {
      if (cliArgs.length !== 1) throw new Error("Usage: bruv --remote-control");
      await runRemoteControl();
    } else {
      if (cliArgs.length !== 2) throw new Error("Usage: bruv --remote-owner <taskId>");
      await runRemoteOwner(cliArgs[1]!);
    }
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Typed root control is human-client transport, not an agent helper or raw TTY.
if (cliArgs[0] === "--remote-root-control" || cliArgs[0] === "--remote-root-owner") {
  const { runRootControl, runRootOwner } = await import("./remote/root/entry");
  try {
    if (cliArgs[0] === "--remote-root-control") {
      if (cliArgs.length !== 1) throw new Error("Usage: bruv --remote-root-control");
      await runRootControl();
    } else {
      if (cliArgs.length !== 2) throw new Error("Usage: bruv --remote-root-owner <sessionId>");
      await runRootOwner(cliArgs[1]!);
    }
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// A placed root is a presentation client, never a second local agent/model/tool loop.
// Resolve before Pi main() and local provider onboarding. Omitted placement stays local.
try {
  const { parseRootPlacementArgs } = await import("./remote/root/options");
  const placement = parseRootPlacementArgs(cliArgs);
  if (placement.remote) {
    const { runRemoteRoot } = await import("./remote/root/cli");
    await runRemoteRoot(placement.remote);
    process.exit(0);
  }
  if (placement.localArgs !== cliArgs) cliArgs.splice(0, cliArgs.length, ...placement.localArgs);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

await runLocalConversation(cliArgs);

// Both internal remote entry points and the local SDK need these paths and identity.
async function configureBruvRuntime(): Promise<void> {
  const runtimeRoot = join(homedir(), ".bruv", "runtime", bruvPackage.version);
  const embeddedAssets: Array<[string, string]> = [
    [metadata as unknown as string, "package.json"],
    [assetImage, "assets/clankolas.png"],
    [themeDark as unknown as string, "theme/dark.json"],
    [themeLight as unknown as string, "theme/light.json"],
    [themeSchema as unknown as string, "theme/theme-schema.json"],
    [exportTemplate as unknown as string, "export-html/template.html"],
    [highlight, "export-html/vendor/highlight.min.js"],
    [marked, "export-html/vendor/marked.min.js"],
  ];

  // Bun stores embedded files under hashed names. Materialize the small set of
  // assets Pi accesses by pathname so the executable remains a single artifact.
  for (const [source, relativeTarget] of embeddedAssets) {
    const target = join(runtimeRoot, relativeTarget);
    try {
      await access(target);
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    await mkdir(join(target, ".."), { recursive: true });
    try {
      // Runtime assets are immutable for a released version. Exclusive creation
      // means later launches perform no writes and concurrent launches do not
      // overwrite one another.
      await writeFile(target, await readFile(source), { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }

  process.title = "bruv";
  process.env.AI_AGENT = "bruv";
  process.env.PI_CODING_AGENT = "true";
  process.env.PI_PACKAGE_DIR = runtimeRoot;
  // Bruv owns explicit self-updates; suppress Pi's separate update lookup and banner.
  process.env.PI_SKIP_VERSION_CHECK = "1";

  // bruv owns the compiled entry point, including Pi's Bun-specific setup.
  registerBunOAuthFlows();
}

// The local SDK startup owns the temporary presentation patches.
async function runLocalConversation(args: string[]): Promise<void> {
  // This must be dynamic: PI_PACKAGE_DIR has to be set before Pi initializes its
  // product metadata and asset paths.
  const { assertBruvPiHost } = await import("./pi-host");
  assertBruvPiHost();
  const { main } = await import("@earendil-works/pi-coding-agent");
  // Install the owned synchronous journal adapter before any SDK session is created.
  const { installDiskBackedSessionManager } = await import("./history/session-manager");
  installDiskBackedSessionManager();
  const { installSelectorLifecycle } = await import("./history/selector-lifecycle");
  installSelectorLifecycle();
  // The UI extension imports Pi's CustomEditor, so it must also load only after
  // bruv's runtime paths and product metadata are configured.
  const [
    { default: asynchronousTasksExtension },
    { default: herdrAgentStateExtension },
    { default: liveExtension },
    { default: remoteExtension },
  ] = await Promise.all([
    import("./agent/extension"),
    import("./herdr-agent-state"),
    import("./live/extension"),
    import("./remote/extension"),
  ]);
  const [
    { installQuietStartup, installStartupEditor },
    { installConversationDensity },
    { installQuietToolUi },
    { installSettledExecuteRendering },
  ] = await Promise.all([
    import("./ui/startup"),
    import("./ui/conversation-density"),
    import("./ui/quiet-tool-ui"),
    import("./ui/settled-execute-render"),
  ]);
  const restoreStartupSettings = installQuietStartup();
  const restoreStartupEditor = installStartupEditor();
  const restoreQuietToolUi = installQuietToolUi();
  const restoreSettledExecuteRendering = installSettledExecuteRendering();
  const restoreConversationDensity = installConversationDensity();
  const { installRollingActivity } = await import("./ui/rolling-activity");
  const restoreRollingActivity = installRollingActivity();

  const optionBoundary = args.indexOf("--");
  const optionArgs = optionBoundary === -1 ? args : args.slice(0, optionBoundary);
  const topLevelHelp = optionArgs.includes("--help") || optionArgs.includes("-h");
  const originalLog = console.log;
  if (topLevelHelp) {
    console.log = (...values: unknown[]) =>
      originalLog(...values.map((value) => (typeof value === "string" ? filterHelp(value) : value)));
  }
  try {
    await main(withBruvSystemPrompt(args), {
      extensionFactories: [
        { name: "bruv-tools", factory: asynchronousTasksExtension, hidden: true },
        { name: "bruv-herdr-agent-state", factory: herdrAgentStateExtension, hidden: true },
        { name: "bruv-live", factory: liveExtension, hidden: true },
        { name: "bruv-remote", factory: remoteExtension, hidden: true },
      ],
    });
  } finally {
    restoreRollingActivity();
    restoreConversationDensity();
    restoreSettledExecuteRendering();
    restoreQuietToolUi();
    restoreStartupEditor();
    restoreStartupSettings();
    console.log = originalLog;
  }
}

function filterHelp(text: string): string {
  if (!text.includes("Usage:") || !text.includes("Options:")) return text;
  const lines = text.split("\n");
  const filtered: string[] = [];
  let skipNextExample = false;
  for (const line of lines) {
    if (skipNextExample) {
      skipNextExample = false;
      continue;
    }
    if (line.includes(" update [source|self|pi]")) {
      filtered.push(
        "  update [--check]       Update/check bruv and bruv-claude-compat together",
        "  web                    Show external T3 native-connector setup guidance",
      );
      continue;
    }
    if (["--no-tools", "--no-builtin-tools", "--tools,", "--exclude-tools"].some((option) => line.includes(option)))
      continue;
    if (line.trim() === "Applies to built-in, extension, and custom tools") continue;
    if (
      line.trim() === "# Read-only mode (no file modifications possible)" ||
      line.trim() === "# Disable one tool while keeping the rest available"
    ) {
      skipNextExample = true;
      continue;
    }
    filtered.push(line.replace("AI coding assistant with read, bash, edit, write tools", "AI coding assistant"));
    if (line.trim() === "Options:")
      filtered.push(
        "  --place <name>         Main agent on a human-authorized target (default: local/current runtime)",
        "  --remote-source <path> Current tracked source for a placed root (default: current repo)",
        "  --remote-include <path>Explicit human approval to include an untracked source path",
        "  --remote-repo <path>   Explicit existing server repo instead of current-source handoff",
        "  --remote-fresh         Explicitly create a new root rather than reattach saved work",
      );
  }
  return filtered.join("\n");
}
