/** Real Live handler under a fixture name; audio defaults and lifecycle stay unchanged. */
import liveExtension from "../../../src/live/extension";
import { createBrowserRequestInput } from "../../../src/live/browser-request";

export default function (pi: any) {
  const input = createBrowserRequestInput();
  pi.on("session_start", (_: unknown, ctx: any) => {
    ctx.ui.onTerminalInput(input.observe);
    ctx.ui.notify("BROWSER AUDIO FIXTURE LOADED", "info");
  });
  const commandPi = new Proxy(pi, {
    get(target, key) {
      if (key === "registerCommand")
        return (_name: string, command: any) =>
          pi.registerCommand("browserlive", {
            ...command,
            handler: (args: string, ctx: any) => input.run(() => command.handler(args, ctx)),
          });
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  liveExtension(commandPi);
}
