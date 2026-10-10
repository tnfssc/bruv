import { basename } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const terminal = (ctx: ExtensionContext) => ctx.hasUI && ctx.mode === "tui" && process.stdout.isTTY;
const clean = (text: string) =>
  stripVTControlCharacters(text)
    .replace(/[;\r\n\t]/g, " ")
    .replace(/\p{Cc}/gu, "");
export function notify(ctx: ExtensionContext, body: string) {
  if (!terminal(ctx)) return;
  const text = clean(body);
  process.stdout.write(
    process.env.KITTY_WINDOW_ID
      ? `\x1b]99;i=1:d=0;bruv\x1b\\\x1b]99;i=1:p=body;${text}\x1b\\\x07`
      : `\x1b]777;notify;bruv;${text}\x07\x07`,
  );
}

export function registerNotifications(pi: ExtensionAPI) {
  let start: number | undefined;
  let answer = "";
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = (ctx: ExtensionContext) => {
    clearInterval(timer);
    timer = undefined;
    start = undefined;
    answer = "";
    if (terminal(ctx)) ctx.ui.setTitle(clean(basename(ctx.cwd)));
  };
  pi.on("session_start", (_event, ctx) => stop(ctx));
  pi.on("session_shutdown", (_event, ctx) => stop(ctx));
  pi.on("agent_start", (_event, ctx) => {
    if (!terminal(ctx) || start !== undefined) return;
    start = Date.now();
    let frame = 0;
    const title = () => ctx.ui.setTitle(`${"⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[frame++ % 10]} working · ${clean(basename(ctx.cwd))}`);
    title();
    timer = setInterval(title, 100);
    timer.unref();
  });
  pi.on("message_end", (event) => {
    if (start !== undefined && event.message.role === "assistant")
      answer = event.message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join(" ");
  });
  pi.on("agent_settled", (event, ctx) => {
    if (!event.aborted && start !== undefined && Date.now() - start > 30000)
      notify(ctx, answer ? `Done: ${clean(answer).slice(0, 60)}` : "Done");
    stop(ctx);
  });
}
