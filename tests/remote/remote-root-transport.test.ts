import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
for (const [module, adapter, entrypoint] of [
  ["src/remote/root/transport.ts", "rootSshTransport", "--remote-root-control"],
  ["src/remote/ssh.ts", "sshTransport", "--remote-control"],
])
  test(`${adapter} uses one JSON request, no TTY/session shell/credentials forwarding`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "root-ssh-fixture-"));
    try {
      await writeFile(
        join(dir, "ssh"),
        "#!" +
          process.execPath +
          "\nlet input='';for await(const s of process.stdin)input+=s;console.log(JSON.stringify({args:process.argv.slice(2),request:JSON.parse(input)}));",
        { mode: 0o700 },
      );
      const child = Bun.spawn(
        [
          process.execPath,
          "-e",
          "import {" +
            adapter +
            "} from " +
            JSON.stringify(resolve(module)) +
            "; console.log(JSON.stringify(await " +
            adapter +
            "('fixture'," +
            JSON.stringify("/fixture/bruv path's") +
            ",{op:'hello'})))",
        ],
        { env: { ...process.env, PATH: dir + ":" + process.env.PATH }, stdout: "pipe", stderr: "pipe" },
      );
      const output = await new Response(child.stdout).text();
      expect(await child.exited).toBe(0);
      const response = JSON.parse(output);
      expect(response.request).toEqual({ op: "hello" });
      expect(response.args).toContain("-T");
      expect(response.args).not.toContain("-t");
      expect(response.args).toContain("ForwardAgent=no");
      expect(response.args).toContain("StrictHostKeyChecking=yes");
      expect(response.args.at(-1)).toBe("'/fixture/bruv path'\\''s' " + entrypoint);
      for (const flag of [
        "BatchMode=yes",
        "ClearAllForwardings=yes",
        "ForwardX11=no",
        "GSSAPIDelegateCredentials=no",
        "PermitLocalCommand=no",
        "UpdateHostKeys=no",
      ])
        expect(response.args).toContain(flag);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
