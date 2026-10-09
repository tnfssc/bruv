import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vesper from "./vesper.json";
import { isCompiledInvocation } from "../update";
import { externalT3Guide } from "../t3/web/launcher";
import { loadWebAssets } from "./assets";
import { startWebServer } from "./server";

export const WEB_HELP =
  "Usage: bruv web [--port PORT] [--host 127.0.0.1|::1|localhost] [-- CLI_ARGS...]\n\nRuns the real Bruv TUI in a local browser terminal. Open the printed token URL.\nFolders and CLIs are on this server. Add reuses a folder already open here.\nBrowsers share tabs and terminal input; disconnect keeps the CLIs alive. Ctrl-C here stops them.\nLoopback only; remote access needs a localhost SSH tunnel with the same host and port as the URL.\nTreat the URL as a shell credential.\nType /live and allow browser microphone permission. Only the owner browser captures and plays audio.\nVoice stays on its original tab. /live stop releases voice, not coding jobs; start again explicitly.\nUse bruv web --setup for the separate external T3 provider setup guide.";

export function webCommand(args: string[]): string[] {
  if (isCompiledInvocation()) return [process.execPath, ...args];
  const entry = process.argv[1];
  if (entry === undefined) throw new Error("Expected the CLI entry path");
  return [process.execPath, entry, ...args];
}

export async function runWeb(args: string[]): Promise<number> {
  if (args.length === 1 && args[0] === "--setup") {
    console.log(externalT3Guide());
    return 0;
  }
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.log(WEB_HELP);
    return 0;
  }
  let hostname = "127.0.0.1";
  let port = 3773;
  let cliArgs: string[] = [];
  let themeDirectory: string | undefined;
  try {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--") {
        cliArgs = args.slice(i + 1);
        break;
      }
      if (arg === "--port") {
        const value = args[++i];
        if (!value || !/^\d+$/.test(value) || Number(value) > 65535)
          throw new Error("--port requires 0–65535 (0 chooses a free port)");
        port = Number(value);
      } else if (arg === "--host") {
        hostname = args[++i] ?? "";
        if (!["127.0.0.1", "::1", "localhost"].includes(hostname))
          throw new Error("--host must be loopback; use an SSH tunnel for remote access");
      } else throw new Error("Unknown web option: " + arg);
    }
    if (cliArgs[0] === "web") throw new Error("Cannot launch bruv web inside its own terminal");
    // Per-run theme flags leave native CLI defaults and saved settings alone.
    themeDirectory = await mkdtemp(join(tmpdir(), "bruv-web-theme-"));
    const themePath = join(themeDirectory, "vesper.json");
    await writeFile(themePath, JSON.stringify(vesper));
    const command = webCommand(["--theme", themePath, "--use-theme", vesper.name, ...cliArgs]);
    const app = startWebServer({ hostname, port, command, assets: await loadWebAssets() });
    console.log("Bruv browser terminal: " + app.url);
    console.log("Keep this process running. Ctrl-C stops the server and its CLIs. The URL grants terminal control.");
    return await new Promise<number>((resolve) => {
      let stopping = false;
      const stop = () => {
        if (stopping) return;
        stopping = true;
        void app
          .stop()
          .then(
            () => resolve(0),
            (error) => {
              console.error(error);
              resolve(1);
            },
          )
          .finally(() => {
            process.off("SIGINT", stop);
            process.off("SIGTERM", stop);
          });
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  } finally {
    if (themeDirectory) await rm(themeDirectory, { recursive: true, force: true });
  }
}
