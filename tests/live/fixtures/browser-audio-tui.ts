/** Startup marker only. Live command, audio selection and device lifecycle are NOT replaced. */
export default function (pi: any) {
  pi.on("session_start", (_: unknown, ctx: any) => ctx.ui.notify("BROWSER AUDIO FIXTURE LOADED", "info"));
}
