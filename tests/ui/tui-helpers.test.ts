import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CombinedAutocompleteProvider, Editor, ProcessTerminal, TuiMainScreen } from "@earendil-works/pi-tui";
import { run } from "../helpers/helpers";
import {
  capturePane,
  frameContaining,
  pasteAndSubmit,
  pollFrame,
  shellQuote,
  tmuxRunner,
} from "../helpers/tui-helpers";

test("POSIX shell quoting roundtrips empty arguments, spaces, apostrophes and shell syntax", async () => {
  const values = ["", "ordinary/path", "space path", "owner's path", "'; $HOME $(echo not-executed)\nnext"];
  const result = await run(["sh", "-c", "printf '%s\\0' " + values.map(shellQuote).join(" ")]);
  expect(result).toEqual({ code: 0, stderr: "", stdout: values.join("\0") + "\0" });
});

test("frameContaining waits for the active monitor, not job names already in the transcript", async () => {
  const transcript = "↗ ALPHA-live\n↗ BETA-live\nFIXTURE_READY\n /ps";
  const roster =
    transcript +
    "\nRunning jobs\n› task_alpha [command] ALPHA-live\n  task_beta [command] BETA-live\nLive preview\nEnter/i inspect";
  const ready = ["Running jobs", "Live preview", "Enter/i inspect", "ALPHA", "BETA"];
  let captures = 0;
  expect(await frameContaining(async () => (++captures === 1 ? transcript : roster), ready, 2, 0)).toBe(roster);
  expect(captures).toBe(2);
  await expect(frameContaining(async () => transcript, ready, 1, 0)).rejects.toThrow("Missing Running jobs");
});

const hasTmux = (await run(["sh", "-c", "command -v tmux >/dev/null"])).code === 0;
test.skipIf(!hasTmux)(
  "tmux primitives preserve private config, viewport and full capture history",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "bruv-tui-primitives-"));
    const socket = "bruv-primitives-" + process.pid + "-" + Date.now();
    const config = join(home, "owner's tmux.conf");
    const tmux = tmuxRunner(socket, config);
    const capture = async (history = false) => {
      const result = await capturePane(tmux, "primitive", history);
      expect(result.code).toBe(0);
      return result.stdout;
    };
    try {
      await writeFile(config, "set -g default-shell /bin/sh\nset -g history-limit 100\nset -g status off\n");
      expect(
        (
          await tmux(
            "new-session",
            "-d",
            "-s",
            "primitive",
            "-x",
            "40",
            "-y",
            "5",
            "-c",
            home,
            "printf 'history-marker\\n'; seq 1 12; printf 'viewport-marker\\n'; exec cat",
          )
        ).code,
      ).toBe(0);
      expect((await tmux("show-options", "-g", "history-limit")).stdout.trim()).toBe("history-limit 100");
      const viewport = await frameContaining(capture, "viewport-marker", 100, 20);
      expect(viewport).not.toContain("history-marker");
      expect(await frameContaining(() => capture(true), ["history-marker", "viewport-marker"])).toContain(
        "history-marker",
      );
      expect(await pollFrame(capture, (frame) => frame.includes("absent-marker"), 2, 0)).toBe(viewport);
      await expect(frameContaining(capture, "absent-marker", 2, 0)).rejects.toThrow("Missing absent-marker in frame:");
    } finally {
      await tmux("kill-server").catch(() => {});
      await rm(home, { recursive: true, force: true });
    }
  },
  10_000,
);

for (const argument of ["start", "stop"])
  test("complete command paste submits once instead of accepting " + argument + " suggestion", async () => {
    // Use Pi's actual editor/provider, but do not start a terminal or call Live.
    const tui = new TuiMainScreen(new ProcessTerminal());
    let rendered: (() => void) | undefined;
    tui.requestRender = () => rendered?.();
    const plain = (text: string) => text;
    const editor = new Editor(tui, {
      borderColor: plain,
      selectList: {
        selectedPrefix: plain,
        selectedText: plain,
        description: plain,
        scrollInfo: plain,
        noMatch: plain,
      },
    });
    editor.setAutocompleteProvider(
      new CombinedAutocompleteProvider(
        [
          {
            name: "liveptt",
            description: "Synthetic Live command",
            getArgumentCompletions: (prefix) =>
              ["start", "stop"].filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value })),
          },
        ],
        import.meta.dir,
      ),
    );
    const submitted: string[] = [];
    editor.onSubmit = (text) => submitted.push(text);
    const command = "/liveptt " + argument;
    editor.setText(command.slice(0, -1));
    // Type the last letter and wait for the argument menu to render.
    const ready = new Promise<void>((resolve) => {
      rendered = resolve;
    });
    editor.handleInput(argument.at(-1)!);
    await ready;
    expect(editor.isShowingAutocomplete()).toBe(true);
    editor.handleInput("\r");
    expect(submitted).toEqual([]);
    expect(editor.getText()).toBe(command);
    editor.setText("");

    const inputs: string[][] = [];
    await pasteAndSubmit(
      async (...args) => {
        inputs.push(args);
        editor.handleInput(args.at(-1) === "Enter" ? "\r" : args.at(-1)!);
        return { code: 0, stdout: "", stderr: "" };
      },
      "ptt",
      command,
    );
    expect(inputs).toEqual([
      ["send-keys", "-t", "ptt", "-l", "\x1b[200~" + command + "\x1b[201~"],
      ["send-keys", "-t", "ptt", "Enter"],
    ]);
    expect(submitted).toEqual([command]);
    expect(editor.getText()).toBe("");
  });
