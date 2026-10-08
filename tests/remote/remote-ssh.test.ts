import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("SSH oversized peer is bounded and force-stopped even when it ignores TERM", async () => {
  const root = await mkdtemp(join(tmpdir(), "remote-ssh-bound-"));
  try {
    await writeFile(
      join(root, "ssh"),
      "#!" +
        process.execPath +
        "\nprocess.on('SIGTERM',()=>{}); process.stdin.resume(); setInterval(()=>process.stdout.write('x'.repeat(65536)), 1);",
      { mode: 0o700 },
    );
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        "import {sshTransport} from " +
          JSON.stringify(resolve("src/remote/ssh.ts")) +
          '; try { await sshTransport("fixture", "bruv", {op:"hello"}); process.exit(2); } catch (e) { console.log(String(e)); }',
      ],
      {
        env: { ...process.env, PATH: root + ":" + process.env.PATH },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const timer = setTimeout(() => child.kill("SIGKILL"), 6000);
    try {
      const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()]);
      expect(code).toBe(0);
      expect(output).toContain("exceeds 4 MB limit; outcome unknown");
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 8000);
