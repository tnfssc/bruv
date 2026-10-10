// Source CLI project trust depends on resources in cwd and its ancestors, not on CI.
// A clean checkout can start directly; a developer checkout may ask for session trust.
export async function waitForLiveTuiStartup(
  frame: () => Promise<string>,
  sendKey: (key: string) => Promise<unknown>,
  fixture: string,
): Promise<void> {
  for (let n = 0; n < 100; n++) {
    const screen = await frame();
    if (screen.includes(fixture)) return;
    if (screen.includes("Trust project folder?")) {
      await sendKey("Down");
      await sendKey("Down");
      await sendKey("Enter"); // Trust (this session only); never persist approval.
      break;
    }
    await Bun.sleep(80);
  }
  for (let n = 0; n < 100; n++) {
    const screen = await frame();
    if (screen.includes(fixture)) return;
    await Bun.sleep(80);
  }
  throw new Error("Missing " + fixture + " in actual terminal:\n" + (await frame()));
}

// Keep the real pane and process state before test cleanup removes the tmux server.
export async function liveTuiFailureDetails(
  tmux: (...args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>,
  target: string,
): Promise<string> {
  const pane = await tmux(
    "list-panes",
    "-t",
    target,
    "-F",
    "pid=#{pane_pid} dead=#{pane_dead} exit=#{pane_dead_status} command=#{pane_current_command} start=#{pane_start_command}",
  );
  const history = await tmux("capture-pane", "-p", "-t", target, "-S", "-");
  return (
    "Pane (code " +
    pane.code +
    "):\n" +
    pane.stdout +
    pane.stderr +
    "History (code " +
    history.code +
    "):\n" +
    history.stdout +
    history.stderr
  );
}
