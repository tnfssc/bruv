import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { QuestionService } from "../src/questions/service";
import { capturePane, frameContaining as waitForText } from "./tui-helpers";

const tmuxBinary = Bun.which("tmux");

// Own the terminal process and its environment; leave its temporary evidence on disk.
async function openQuestionTerminal(session: SessionManager, home: string) {
  const config = await mkdtemp(join(home, "config-"));
  const sdk = await mkdtemp(join(home, "sdk-"));
  const temp = await mkdtemp(join(home, "tmp-"));
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: join(home, "cache"),
    XDG_DATA_HOME: join(home, "data"),
    XDG_STATE_HOME: join(home, "state"),
    PI_CODING_AGENT_DIR: sdk,
    BRUV_CODING_AGENT_DIR: sdk,
    TMPDIR: temp,
    TERM: "xterm-256color",
    LANG: "C.UTF-8",
    OPENAI_API_KEY: "offline-test-placeholder",
    HERDR_ENV: "0",
  };
  const socket = join(temp, "tmux.sock");
  const tmux = (...args: string[]) =>
    new Promise<{ stdout: string; stderr: string; code: number }>((done) => {
      execFile(tmuxBinary!, ["-S", socket, "-f", "/dev/null", ...args], { cwd: home, env }, (error, stdout, stderr) => {
        done({ stdout, stderr, code: error ? (typeof error.code === "number" ? error.code : 1) : 0 });
      });
    });
  const close = () => tmux("kill-server");
  const frame = async () => (await capturePane(tmux, "q")).stdout;
  const key = async (...keys: string[]) => {
    expect((await tmux("send-keys", "-t", "q", ...keys)).code).toBe(0);
  };
  const type = async (text: string) => {
    expect((await tmux("send-keys", "-t", "q", "-l", text)).code).toBe(0);
  };
  try {
    const file = session.getSessionFile()!;
    await writeFile(
      file,
      [session.getHeader(), ...session.getEntries()].map((v) => JSON.stringify(v)).join("\n") + "\n",
    );
    // Multiple tmux command arguments execute the CLI directly, without a shell or inherited config.
    expect(
      (
        await tmux(
          "new-session",
          "-d",
          "-s",
          "q",
          "-x",
          "120",
          "-y",
          "35",
          "-c",
          home,
          resolve(import.meta.dir, "../dist/bruv"),
          "--offline",
          "--no-approve",
          "--session",
          file,
          "--provider",
          "openai",
          "--model",
          "gpt-4o",
        )
      ).code,
    ).toBe(0);
    return {
      key,
      type,
      frame,
      until: (text: string) => waitForText(frame, text, 100, 60),
      resize: async (width: string, height: string) => {
        expect((await tmux("resize-window", "-t", "q", "-x", width, "-y", height)).code).toBe(0);
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

test.skipIf(!tmuxBinary)(
  "real /questions inbox, editor and choice persist only on submit",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "bruv-interactive-questions-"));
    const session = SessionManager.create(home, join(home, "sessions"));
    session.appendCustomEntry("test-seed", {});
    const service = new QuestionService();
    const ctx = { sessionManager: session };
    const first = await service.ask(ctx, {
      text: "Where is the crackle?",
      choices: ["Playback", "Recording", "Both"],
      allowFreeText: false,
    });
    const second = await service.ask(ctx, {
      text: "Describe the second issue",
      choices: ["Skip"],
      allowFreeText: true,
    });
    const terminal = await openQuestionTerminal(session, home);
    const { key, type, until } = terminal;
    try {
      await until("2 /questions");
      await type("/questions");
      await key("Enter");
      expect(await until("2 unanswered")).toContain("Where is the crackle?");
      await key("Escape");
      await Bun.sleep(100);
      expect(service.get(ctx, first.id).status).toBe("pending");
      await type("/questions");
      await key("Enter");
      await until("2 unanswered");
      await key("Enter");
      expect(await until("Playback")).toContain("Recording");
      await key("Escape");
      expect(await until("2 unanswered")).toContain("Where is the crackle?");
      expect(service.get(ctx, first.id).status).toBe("pending");
      await key("Enter");
      await until("Playback");
      await key("Down", "Enter");
      await until("1 unanswered");
      expect(service.get(ctx, first.id).answer).toBe("Recording");
      expect(await until("1 unanswered")).toContain("Describe the second issue");
      await key("Enter");
      await until("Write an answer");
      await key("Down", "Enter");
      await until("enter submit");
      await type("Discard this draft");
      await key("Escape");
      expect(await until("Write an answer")).toContain("Skip");
      expect(service.get(ctx, second.id).status).toBe("pending");
      await key("Down", "Enter");
      await until("enter submit");
      await type("A reproducible free text answer");
      await key("Enter");
      await until("2 saved");
      expect(service.get(ctx, second.id).answer).toBe("A reproducible free text answer");
      // Completion comes from the live command registry, not a picker fixture.
      await type("/questions de");
      expect(await until("→ detail")).toContain("/questions de");
      await key("Tab");
      expect(await until("/questions detail")).toContain("/questions detail");
      await key("C-u");
    } finally {
      await terminal.close();
    }
  },
  30000,
);

test.skipIf(!tmuxBinary)(
  "real /questions narrow picker rejects a changed snapshot",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "bruv-interactive-questions-"));
    const session = SessionManager.create(home, join(home, "sessions"));
    session.appendCustomEntry("test-seed", {});
    const service = new QuestionService();
    const ctx = { sessionManager: session };
    const stale = await service.ask(ctx, {
      text: "A long question about narrow terminal rendering and whether the selected choice is still fully readable?",
      choices: [
        "An intentionally long option that must remain fully readable even on a narrow choice label",
        "Alternative",
      ],
      allowFreeText: false,
    });
    const terminal = await openQuestionTerminal(session, home);
    const { key, type, until, frame, resize } = terminal;
    try {
      await until("1 /questions");
      await type("/questions");
      await key("Enter");
      expect(await until("1 unanswered")).toContain("A long question");
      await key("Enter");
      const wide = await until("An intentionally long option");
      expect(wide).toContain("Alternative");
      await resize("48", "18");
      await Bun.sleep(150);
      const narrow = await frame();
      expect(narrow).toContain("narrow choice label");
      expect(narrow).toContain("Alternative");
      // Mutate the snapshot while the choice picker is open; the runtime must reject it.
      await service.block(ctx, {
        id: stale.id,
        owner: stale.owner,
        version: stale.version,
        checkpoint: "changed while picking",
        foreground: true,
      });
      await key("Enter");
      expect(await until("Question changed")).toContain("Question changed");
      expect(service.get(ctx, stale.id).status).toBe("pending");
    } finally {
      await terminal.close();
    }
  },
  30000,
);
