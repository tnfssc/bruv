import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { QuestionService } from "../src/questions/service";
import { run } from "./helpers";

const hasTmux = (await run(["sh", "-c", "command -v tmux >/dev/null"])).code === 0;
test.skipIf(!hasTmux)(
  "real /questions inbox, editor and choice persist only on submit",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "die-interactive-questions-"));
    const socket = "die-qinteractive-" + process.pid + "-" + Date.now();
    const session = SessionManager.create(home, join(home, "sessions"));
    session.appendCustomEntry("test-seed", {});
    const file = session.getSessionFile()!;
    const service = new QuestionService();
    const ctx = { sessionManager: session };
    const tmux = (...args: string[]) => run(["tmux", "-L", socket, ...args]);
    const key = async (...keys: string[]) => {
      expect((await tmux("send-keys", "-t", "q", ...keys)).code).toBe(0);
    };
    const type = async (text: string) => {
      expect((await tmux("send-keys", "-t", "q", "-l", text)).code).toBe(0);
    };
    const frame = async () => (await tmux("capture-pane", "-p", "-t", "q")).stdout;
    const until = async (marker: string) => {
      let f = "";
      for (let i = 0; i < 100; i++) {
        f = await frame();
        if (f.includes(marker)) return f;
        await Bun.sleep(60);
      }
      throw new Error("Missing " + marker + "\n" + f);
    };
    const launch = [
      "env",
      "-u",
      "DIE_SUBAGENT_DEPTH",
      "-u",
      "DIE_SUBAGENT_TYPE",
      "HOME=" + home,
      "OPENAI_API_KEY=offline-test-placeholder",
      resolve(import.meta.dir, "../dist/die"),
      "--offline",
      "--no-approve",
      "--session",
      file,
      "--provider",
      "openai",
      "--model",
      "gpt-4o",
    ]
      .map((v) => "'" + v.replaceAll("'", "'\''") + "'")
      .join(" ");
    try {
      await writeFile(
        file,
        [session.getHeader(), ...session.getEntries()].map((v) => JSON.stringify(v)).join("\n") + "\n",
      );
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
      expect((await tmux("new-session", "-d", "-s", "q", "-x", "120", "-y", "35", "-c", home, launch)).code).toBe(0);
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
      const stale = await service.ask(ctx, {
        text: "A long question about narrow terminal rendering and whether the selected choice is still fully readable?",
        choices: [
          "An intentionally long option that must remain fully readable even on a narrow choice label",
          "Alternative",
        ],
        allowFreeText: false,
      });
      await type("/questions");
      await key("Enter");
      expect(await until("1 unanswered")).toContain("A long question");
      await key("Enter");
      const wide = await until("An intentionally long option");
      expect(wide).toContain("Alternative");
      expect((await tmux("resize-window", "-t", "q", "-x", "48", "-y", "18")).code).toBe(0);
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
      await tmux("kill-server").catch(() => {});
      await rm(home, { recursive: true, force: true });
    }
  },
  30000,
);
