export function liveLocalOnly(mode: string, env: Record<string, string | undefined>, tty: boolean): boolean {
  return (
    mode === "tui" &&
    tty &&
    !env.SSH_CONNECTION &&
    !env.SSH_CLIENT &&
    !env.SSH_TTY &&
    !env.BRUV_WEB_BRUV_BINARY &&
    !(Number(env.BRUV_SUBAGENT_DEPTH) > 0)
  );
}
