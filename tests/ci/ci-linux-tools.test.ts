import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Linux fixture install shares cached debs, skips installed packages and bounds apt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-ci-tools-"));
  try {
    const bin = join(dir, "bin");
    await mkdir(bin);
    const sources = join(dir, "ubuntu.sources");
    await writeFile(sources, "fixture");
    const source = await Bun.file("scripts/ci/install-ci-linux-tools.sh").text();
    const script = join(dir, "install.sh");
    await writeFile(script, source.replace("sources=/etc/apt/sources.list.d/ubuntu.sources", "sources=" + sources));
    for (const [name, body] of Object.entries({
      "dpkg-query":
        'if [ "$ALL_INSTALLED" = 1 ] || [ "$3" = tmux ]; then printf "install ok installed"; else exit 1; fi',
      sudo: 'printf "%s\n" "$*" >> "$INSTALL_LOG"',
      tmux: "echo tmux-fixture",
      ffmpeg: "echo ffmpeg-fixture",
      getconf: "echo 2",
    })) {
      const file = join(bin, name);
      await writeFile(file, "#!/bin/sh\n" + body + "\n");
      await chmod(file, 0o755);
    }
    const log = join(dir, "calls");
    const run = async (installed: string) => {
      const child = Bun.spawn(["/bin/bash", script, "--native-audio"], {
        env: {
          ...process.env,
          PATH: bin + ":/usr/bin:/bin",
          RUNNER_TEMP: dir,
          INSTALL_LOG: log,
          ALL_INSTALLED: installed,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    };
    await run("0");
    const calls = await readFile(log, "utf8");
    expect(calls.split("\n").filter(Boolean)).toHaveLength(2);
    expect(calls).toContain("timeout 90 apt-get");
    expect(calls).toContain("timeout 180 apt-get");
    expect(calls).toContain("Dir::Cache::archives=" + dir + "/bruv-apt-cache");
    expect(calls).toContain("Dir::Etc::sourceparts=-");
    expect(calls).toContain("Acquire::https::Timeout=15");
    expect(calls).toContain("install -y --no-install-recommends ffmpeg clang");
    expect(calls).not.toContain(" tmux");
    await run("1");
    expect(await readFile(log, "utf8")).toBe(calls);
    for (const name of ["ci", "release"]) {
      const workflow = await Bun.file(".github/workflows/" + name + ".yml").text();
      expect(workflow).toContain("bruv-apt-cache/*.deb");
      expect(workflow).toContain("ubuntu-24.04-apt-v1-");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
