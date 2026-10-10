export function liveLocalOnly(mode: string, env: Record<string, string | undefined>, tty: boolean): boolean {
  return (
    mode === "tui" &&
    tty &&
    (Boolean(env.BRUV_LIVE_RELAY_URL && env.BRUV_LIVE_RELAY_SECRET) ||
      (!env.SSH_CONNECTION && !env.SSH_CLIENT && !env.SSH_TTY && !env.BRUV_WEB_BRUV_BINARY)) &&
    !(Number(env.BRUV_SUBAGENT_DEPTH) > 0)
  );
}

/** Presentation facts from the active run, not a second lifecycle or readiness owner. */
export function compactLiveStatus(run: {
  running: boolean;
  inputMode: "continuous" | "push-to-talk";
  talking: boolean;
  inputAvailable: boolean;
  speaking: boolean;
  thinking: boolean;
}): string {
  if (!run.running) return "Voice · connecting";
  if (run.inputMode === "continuous") return run.speaking ? "Speaking · mic on" : "Voice · mic on";

  // In push-to-talk, the mic gate and input availability take priority over output activity.
  if (run.talking) return "Listening · release Space to finish";
  if (!run.inputAvailable) return "Voice · input unavailable";
  if (run.speaking) return "Speaking · hold Space to reply";
  if (run.thinking) return "Thinking · hold Space to speak";
  return "Voice · hold Space to speak";
}
