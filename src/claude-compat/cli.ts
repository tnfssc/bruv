import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import product from "../../package.json";
import image from "../../runtime-assets/assets/clankolas.png" with { type: "file" };
import template from "../../runtime-assets/export-html/template.html" with { type: "file" };
import highlight from "../../runtime-assets/export-html/vendor/highlight.min.js" with { type: "file" };
import marked from "../../runtime-assets/export-html/vendor/marked.min.js" with { type: "file" };
import metadata from "../../runtime-assets/package.json" with { type: "file" };
import dark from "../../runtime-assets/theme/dark.json" with { type: "file" };
import light from "../../runtime-assets/theme/light.json" with { type: "file" };
import themeSchema from "../../runtime-assets/theme/theme-schema.json" with { type: "file" };
import { parseConnectorArguments, assertLaunchBindings, type ConnectorArguments } from "./arguments";
import { ClaudeCompatTransport, type TransportOptions, type WireMessage } from "./transport";

export const CONNECTOR_VERSION = "bruv-claude-compat " + product.version;
export const CONNECTOR_HELP = [
  "bruv-claude-compat \u2014 Bruv connector, not Anthropic Claude Code",
  "",
  "Usage:",
  "  bruv-claude-compat --input-format stream-json --output-format stream-json",
  "    --permission-mode bypassPermissions --allow-dangerously-skip-permissions",
  "    [--model provider/id] [--verbose] [--include-partial-messages]",
  "    [--append-system-prompt TEXT] [--no-session-persistence]",
  "  bruv-claude-compat -p --output-format json --json-schema JSON",
  '    [--model provider/id] [--tools ""] [--permission-mode dontAsk]',
  "    [--disable-slash-commands] [--strict-mcp-config] [PROMPT]",
  "  bruv-claude-compat --help | --version",
  "",
  "Stream stdin/stdout are NDJSON; auxiliary stdin is plain text and stdout is one",
  "validated structured_output result. Diagnostics go only to stderr.",
  "BRUV_CLAUDE_COMPAT_HOME selects isolated Bruv connector state (default:",
  "~/.bruv/claude-compat). No CLI state or real Claude history is migrated.",
  "BRUV_CLAUDE_COMPAT_BRUV_PATH selects the normal Bruv binary for child work",
  "(default: sibling bruv). Configure credentials/models in connector state.",
  "Initialization checks local readiness, never provider access or subscription.",
  "Permissions/MCP/resume/settings flags not yet bound fail explicitly.",
  "",
].join("\n");

/** Structural port matches runtime.ts. An injected engine never boots Pi or
 * changes process identity, so launch glue can be tested before integration. */
export interface ConnectorRuntimeOptions {
  cwd: string;
  agentDir: string;
  emit(frame: WireMessage): void | Promise<void>;
  model?: string;
  appendSystemPrompt?: string[];
  auxiliary?: boolean;
  permissionMode?: string;
  executablePath?: string;
  diagnostic?(error: unknown): void;
}
export interface ConnectorRuntime {
  onUser: TransportOptions["onUser"];
  controls: TransportOptions["controls"];
  close(): Promise<void>;
  runAuxiliary(text: string, schema: Record<string, unknown>): Promise<WireMessage>;
}
export type RuntimeFactory = (options: ConnectorRuntimeOptions, args: ConnectorArguments) => Promise<ConnectorRuntime>;
export interface ConnectorIO {
  input: Readable;
  output: Writable;
  stderr: Writable;
  cwd: string;
  env: NodeJS.ProcessEnv;
  home: string;
  signals: { on(event: string, listener: () => void): unknown; off(event: string, listener: () => void): unknown };
}

async function bootstrap(agentDir: string) {
  const root = join(agentDir, "runtime", product.version);
  const assets: Array<[string, string]> = [
    [metadata as unknown as string, "package.json"],
    [image, "assets/clankolas.png"],
    [dark as unknown as string, "theme/dark.json"],
    [light as unknown as string, "theme/light.json"],
    [themeSchema as unknown as string, "theme/theme-schema.json"],
    [template as unknown as string, "export-html/template.html"],
    [highlight, "export-html/vendor/highlight.min.js"],
    [marked, "export-html/vendor/marked.min.js"],
  ];
  for (const [source, relative] of assets) {
    const destination = join(root, relative);
    await mkdir(dirname(destination), { recursive: true });
    try {
      await writeFile(destination, await readFile(source), { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  process.title = "bruv-claude-compat";
  process.env.AI_AGENT = "bruv";
  process.env.PI_CODING_AGENT = "true";
  process.env.BRUV_CODING_AGENT_DIR = agentDir;
  process.env.PI_PACKAGE_DIR = root;
  process.env.PI_SKIP_VERSION_CHECK = "1";
  const { registerBunOAuthFlows } = await import("@earendil-works/pi-ai/bun-oauth");
  registerBunOAuthFlows();
  const { assertBruvPiHost } = await import("../pi-host");
  assertBruvPiHost();
}

const productionRuntime: RuntimeFactory = async (options, args) => {
  await access(options.executablePath!);
  await bootstrap(options.agentDir);
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const { createClaudeCompatRuntime } = await import("./runtime");
  return createClaudeCompatRuntime({
    ...options,
    ...(args.noPersistence ? { sessionManager: SessionManager.inMemory(options.cwd) } : {}),
  });
};

function detail(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
async function write(output: Writable, text: string): Promise<void> {
  await new Promise<void>((resolve, reject) => output.write(text, (error) => (error ? reject(error) : resolve())));
}

export async function runConnector(
  argv: string[],
  factory: RuntimeFactory = productionRuntime,
  io: ConnectorIO = {
    input: process.stdin,
    output: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
    env: process.env,
    home: homedir(),
    signals: process,
  },
): Promise<number> {
  let runtime: ConnectorRuntime | undefined;
  let transport: ClaudeCompatTransport | undefined;
  let closing: Promise<void> | undefined;
  let shutdownError: unknown;
  let stopped: "EOF" | "SIGTERM" | "SIGINT" | undefined;
  const close = () => (runtime ? (closing ??= runtime.close()) : Promise.resolve());
  const stop = (reason: "EOF" | "SIGTERM" | "SIGINT") => {
    stopped ??= reason;
    transport?.close(new Error("Connector stopped: " + reason));
    io.input.destroy();
    void close().catch((error) => {
      shutdownError = error;
    });
  };
  const terminate = () => stop("SIGTERM"),
    interrupt = () => stop("SIGINT");
  const eof = () => stop("EOF");
  try {
    const args = parseConnectorArguments(argv);
    if (args.action !== "run") {
      await write(io.output, args.action === "version" ? CONNECTOR_VERSION + "\n" : CONNECTOR_HELP);
      return 0;
    }
    assertLaunchBindings(args);
    const agentDir = resolve(io.env.BRUV_CLAUDE_COMPAT_HOME ?? join(io.home, ".bruv", "claude-compat"));
    const normalBinary = resolve(io.env.BRUV_CLAUDE_COMPAT_BRUV_PATH ?? join(dirname(process.execPath), "bruv"));
    io.signals.on("SIGTERM", terminate);
    io.signals.on("SIGINT", interrupt);
    runtime = await factory(
      {
        cwd: io.cwd,
        agentDir,
        model: args.model,
        appendSystemPrompt: args.appendSystemPrompt,
        auxiliary: args.mode === "auxiliary",
        permissionMode: args.mode === "auxiliary" ? "dontAsk" : args.permissionMode,
        executablePath: normalBinary,
        emit: (frame) => {
          // Once the peer closes/stops, teardown must not publish another turn.
          if (stopped) return;
          if (args.mode === "auxiliary")
            throw new Error("Auxiliary runtime must return a single result, not emit frames");
          if (frame.type === "stream_event" && !args.partialMessages) return;
          if (!transport) throw new Error("Runtime emitted before transport was bound");
          return transport.send(frame);
        },
        diagnostic: (error) => {
          io.stderr.write("[bruv-claude-compat] " + detail(error) + "\n");
        },
      },
      args,
    );
    if (stopped) {
      await close();
      return stopped === "SIGTERM" ? 143 : 130;
    }
    if (args.mode === "auxiliary") {
      let prompt = args.prompt;
      if (prompt === undefined) {
        const chunks: Buffer[] = [];
        for await (const chunk of io.input) chunks.push(Buffer.from(chunk));
        prompt = Buffer.concat(chunks).toString("utf8");
      }
      if (!prompt.trim()) throw new Error("Auxiliary prompt is empty");
      const result = await runtime.runAuxiliary(prompt, args.schema!);
      if (!stopped) await write(io.output, JSON.stringify(result) + "\n");
    } else {
      transport = new ClaudeCompatTransport({
        input: io.input,
        output: io.output,
        stderr: io.stderr,
        onUser: runtime.onUser,
        controls: runtime.controls,
      });
      io.input.on("end", eof);
      try {
        await transport.run();
      } catch (error) {
        if (!stopped) throw error;
      }
    }
    await close();
    if (shutdownError) throw shutdownError;
    return stopped === "SIGTERM" ? 143 : stopped === "SIGINT" ? 130 : 0;
  } catch (error) {
    if (stopped && !shutdownError) {
      try {
        await close();
        return stopped === "SIGTERM" ? 143 : stopped === "SIGINT" ? 130 : 0;
      } catch (shutdown) {
        io.stderr.write("[bruv-claude-compat] shutdown failed: " + detail(shutdown) + "\n");
        return 1;
      }
    }
    io.stderr.write("[bruv-claude-compat] " + detail(error) + "\n");
    return 1;
  } finally {
    io.input.off("end", eof);
    io.signals.off("SIGTERM", terminate);
    io.signals.off("SIGINT", interrupt);
    transport?.close();
    try {
      await close();
    } catch (error) {
      io.stderr.write("[bruv-claude-compat] shutdown failed: " + detail(error) + "\n");
    }
  }
}

if (import.meta.main) process.exitCode = await runConnector(process.argv.slice(2));
