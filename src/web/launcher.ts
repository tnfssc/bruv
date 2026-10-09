import { isCompiledInvocation } from "../update";
import { externalT3Guide } from "../t3/web/launcher";
import { loadWebAssets } from "./assets";
import { startWebServer } from "./server";

export const WEB_HELP =
  "Usage: bruv web [--port PORT] [--host 127.0.0.1|::1|localhost] [-- CLI_ARGS...]\n\nRuns the real Bruv TUI in a local browser terminal. Open the printed token URL.\nBrowsers share workspace tabs and terminal input; disconnect keeps the CLIs alive. Ctrl-C here stops them.\nLoopback only; use an SSH tunnel for remote access. Treat the URL as a shell credential.\nClick Enable microphone, then type /live. Your browser handles microphone and speakers; agents run here.\nUse bruv web --setup for the separate external T3 provider setup guide.";

export function webCommand(args: string[]): string[] {
  return isCompiledInvocation() ? [process.execPath, ...args] : [process.execPath, process.argv[1]!, ...args];
}

export async function runWeb(args: string[]): Promise<number> {
  if (args.length === 1 && args[0] === "--setup") {
    console.log(externalT3Guide());
    return 0;
  }
  if (args.length === 1 && ["--help", "-h"].includes(args[0]!)) {
    console.log(WEB_HELP);
    return 0;
  }
  let hostname = "127.0.0.1";
  let port = 3773;
  let cliArgs: string[] = [];
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
    const app = startWebServer({ hostname, port, command: webCommand(cliArgs), assets: await loadWebAssets() });
    console.log("Bruv browser terminal: " + app.url);
    console.log("Keep this process running. Ctrl-C stops the server and its CLI. The URL grants terminal control.");
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
  }
}
