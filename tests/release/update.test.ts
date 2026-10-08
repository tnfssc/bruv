import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type UpdateDeps, UPDATE_ASSETS, isCompiledInvocation, updateAssetFor, updateBruv } from "../../src/update";
import { ownedFixtureEnv } from "../helpers/helpers";

const body = new TextEncoder().encode("new compiled bruv");
const connectorBody = new TextEncoder().encode("new compiled connector");
const releaseUrl = "https://api.github.com/repos/tnfssc/bruv/releases/latest";
const dirs = new Set<string>();
const root = (tag: string) => "https://github.com/tnfssc/bruv/releases/download/" + tag + "/";
const deps = (fetch: typeof globalThis.fetch, executable: string, extra: UpdateDeps = {}): UpdateDeps => ({
  fetch,
  executable,
  currentVersion: "0.2.15",
  platform: "linux",
  arch: "x64",
  compiled: true,
  runBinary: async (path: string) => (path.endsWith("bruv-claude-compat") ? "bruv-claude-compat 0.3.0" : "0.3.0"),
  ...extra,
});
async function target(kind = "file") {
  const dir = await mkdtemp("/var/tmp/bruv-update-test-");
  dirs.add(dir);
  const path = join(dir, "bruv");
  if (kind === "directory") {
    await mkdir(path);
    await writeFile(join(path, "old"), "old");
  } else await writeFile(path, "old", { mode: 0o754 });
  return { dir, path };
}
type ArtifactOptions = {
  binaryBody?: Uint8Array<ArrayBuffer>;
  binaryStatus?: number;
  checksum?: string;
  checksumFile?: string;
  checksumStatus?: number;
  missingBinary?: boolean;
  missingChecksum?: boolean;
  checksumUrl?: string;
};
type ReleaseOptions = {
  asset?: string;
  release?: unknown;
  bruv?: ArtifactOptions;
  connector?: ArtifactOptions;
  beforeBruvChecksum?: () => Promise<void>;
};

function fixture(tag = "v0.3.0", options: ReleaseOptions = {}) {
  const asset = options.asset ?? "bruv-linux-x64";
  const artifacts = [
    { name: asset, expectedBody: body, options: options.bruv ?? {} },
    {
      name: asset.replace(/^bruv-/, "bruv-claude-compat-"),
      expectedBody: connectorBody,
      options: options.connector ?? {},
    },
  ];
  const release = options.release ?? {
    tag_name: tag,
    assets: artifacts.flatMap(({ name, options }) => {
      const url = root(tag) + name;
      const assets = [];
      if (!options.missingBinary) assets.push({ name, browser_download_url: url });
      if (!options.missingChecksum)
        assets.push({ name: name + ".sha256", browser_download_url: options.checksumUrl ?? url + ".sha256" });
      return assets;
    }),
  };
  const calls: string[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url === releaseUrl) return Response.json(release);
    if (url === root(tag) + asset + ".sha256") await options.beforeBruvChecksum?.();
    for (const { name, expectedBody, options } of artifacts) {
      const binaryUrl = root(tag) + name;
      if (url === binaryUrl)
        return new Response(options.binaryBody ?? expectedBody, { status: options.binaryStatus ?? 200 });
      if (url === binaryUrl + ".sha256") {
        // Hash the expected payload, not a deliberately truncated/corrupt response.
        const checksum = options.checksum ?? createHash("sha256").update(expectedBody).digest("hex");
        return new Response(checksum + "  " + (options.checksumFile ?? name) + "\n", {
          status: options.checksumStatus ?? 200,
        });
      }
    }
    throw new Error("unexpected URL " + url);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}
afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  dirs.clear();
});

describe("invocation and release authority", () => {
  test("source guard rejects before any network", async () => {
    let calls = 0;
    await expect(
      updateBruv({
        compiled: false,
        platform: "linux",
        arch: "x64",
        fetch: (async () => {
          calls++;
          throw Error("network");
        }) as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("source Bun");
    expect(calls).toBe(0);
  });

  test("maps supported update assets", () => {
    expect(updateAssetFor("linux", "x64")).toBe(UPDATE_ASSETS["linux-x64"]);
    expect(updateAssetFor("linux", "arm64")).toBe(UPDATE_ASSETS["linux-arm64"]);
    expect(updateAssetFor("darwin", "arm64")).toBe(UPDATE_ASSETS["darwin-arm64"]);
    expect(updateAssetFor("android", "arm64")).toBe(UPDATE_ASSETS["android-arm64"]);
    expect(updateAssetFor("darwin", "x64")).toBeUndefined();
  });

  test("downloads the matching macOS asset", async () => {
    const f = fixture("v0.3.0", { asset: "bruv-darwin-arm64" });
    const x = await target();
    await expect(updateBruv(deps(f.fetch, x.path, { platform: "darwin", arch: "arm64" }))).resolves.toMatchObject({
      status: "updated",
    });
    expect(await Bun.file(x.path).bytes()).toEqual(body);
    expect(f.calls).toEqual([
      releaseUrl,
      root("v0.3.0") + "bruv-darwin-arm64",
      root("v0.3.0") + "bruv-darwin-arm64.sha256",
      root("v0.3.0") + "bruv-claude-compat-darwin-arm64",
      root("v0.3.0") + "bruv-claude-compat-darwin-arm64.sha256",
    ]);
  });

  test("unsupported platform rejects before fetch", async () => {
    let calls = 0;
    await expect(
      updateBruv({
        platform: "win32",
        arch: "x64",
        compiled: true,
        fetch: (async () => {
          calls++;
        }) as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("Linux x64/arm64, macOS arm64, and Android/Termux arm64");
    expect(calls).toBe(0);
  });

  test.each([
    ["foreign repository", "https://example.invalid/bruv-linux-x64"],
    // The renamed repository must be used even if GitHub redirects the old slug.
    ["legacy repository", "https://github.com/tnfssc/die/releases/download/v0.3.0/bruv-linux-x64"],
  ])("requires canonical exact asset URLs: %s", async (_label, url) => {
    const f = fixture("v0.3.0", {
      release: {
        tag_name: "v0.3.0",
        assets: [
          { name: "bruv-linux-x64", browser_download_url: url },
          { name: "bruv-linux-x64.sha256", browser_download_url: root("v0.3.0") + "bruv-linux-x64.sha256" },
          {
            name: "bruv-claude-compat-linux-x64",
            browser_download_url: root("v0.3.0") + "bruv-claude-compat-linux-x64",
          },
          {
            name: "bruv-claude-compat-linux-x64.sha256",
            browser_download_url: root("v0.3.0") + "bruv-claude-compat-linux-x64.sha256",
          },
        ],
      },
    });
    const x = await target();
    await expect(updateBruv(deps(f.fetch, x.path))).rejects.toThrow("valid official bruv-linux-x64 asset");
    expect(f.calls).toEqual([releaseUrl]);
  });

  test("malformed, prerelease, and missing release assets stop before binary", async () => {
    for (const release of [
      { tag_name: "garbage", assets: [] },
      { tag_name: "v0.3.0", prerelease: true, assets: [] },
      { tag_name: "v0.3.0", assets: [] },
    ]) {
      const f = fixture("v0.3.0", { release });
      await expect(updateBruv(deps(f.fetch, "/no-target"))).rejects.toThrow();
      expect(f.calls).toEqual([releaseUrl]);
    }
  });

  test("metadata network failure preserves executable", async () => {
    const x = await target();
    const offline = (async () => {
      throw new Error("offline");
    }) as unknown as typeof globalThis.fetch;
    await expect(updateBruv(deps(offline, x.path))).rejects.toThrow("Unable to check");
    expect(await Bun.file(x.path).text()).toBe("old");
  });
});

describe("installation layout and file identity", () => {
  test("updates and preserves mode", async () => {
    const x = await target();
    await updateBruv(deps(fixture().fetch, x.path));
    expect(await Bun.file(x.path).text()).toBe("new compiled bruv");
    expect((await stat(x.path)).mode & 0o777).toBe(0o754);
  });

  test("updates symlink target and preserves symlink", async () => {
    const x = await target();
    const link = join(x.dir, "link");
    await symlink(x.path, link);
    await updateBruv(deps(fixture().fetch, link));
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(new TextDecoder().decode(await readFile(x.path))).toBe("new compiled bruv");
  });

  test("directory target is rejected without staging", async () => {
    const x = await target("directory");
    const f = fixture();
    await expect(updateBruv(deps(f.fetch, x.path))).rejects.toThrow(/manual action|not a regular file/);
    expect(await Bun.file(join(x.path, "old")).text()).toBe("old");
    expect((await readdir(x.dir)).filter((n) => n.startsWith(".bruv-update-")).length).toBe(0);
  });

  test.skipIf(process.getuid?.() === 0)(
    "permission failure preserves executable without staging leftovers",
    async () => {
      const x = await target();
      const f = fixture();
      await chmod(x.dir, 0o500);
      try {
        await expect(updateBruv(deps(f.fetch, x.path))).rejects.toThrow(
          /Could not update Bruv pair \(create staging directory\):.*(?:EACCES|permission denied)/i,
        );
        expect(f.calls).toEqual([releaseUrl]);
        expect(await Bun.file(x.path).text()).toBe("old");
        expect((await readdir(x.dir)).filter((name) => name.startsWith(".bruv-update-"))).toEqual([]);
      } finally {
        await chmod(x.dir, 0o700);
      }
    },
  );

  test("normal-only install gains the pair and keeps user data", async () => {
    const x = await target();
    await mkdir(join(x.dir, "state"));
    await writeFile(join(x.dir, "state", "settings.json"), "private existing data");
    expect(await updateBruv(deps(fixture().fetch, x.path))).toMatchObject({ status: "updated" });
    expect(await readFile(x.path, "utf8")).toBe("new compiled bruv");
    expect(await readFile(join(x.dir, "bruv-claude-compat"), "utf8")).toBe("new compiled connector");
    expect(await readFile(join(x.dir, "state", "settings.json"), "utf8")).toBe("private existing data");
  });

  test("existing connector mode is preserved", async () => {
    const x = await target();
    const connector = join(x.dir, "bruv-claude-compat");
    await writeFile(connector, "old connector", { mode: 0o751 });
    await updateBruv(deps(fixture().fetch, x.path));
    expect((await stat(connector)).mode & 0o777).toBe(0o751);
  });

  test.each(["directory", "symlink", "renamed bruv"])("%s layout requires manual action", async (kind) => {
    const x = await target();
    const connector = join(x.dir, "bruv-claude-compat");
    let path = x.path;
    if (kind === "directory") await mkdir(connector);
    if (kind === "symlink") await symlink(x.path, connector);
    if (kind === "renamed bruv") {
      path = join(x.dir, "custom-name");
      await rename(x.path, path);
    }
    const f = fixture();
    await expect(updateBruv(deps(f.fetch, path))).rejects.toThrow("manual action");
    expect(await readFile(path, "utf8")).toBe("old");
    expect(f.calls).toEqual([releaseUrl]);
  });
});

describe("release selection and installed pair repair", () => {
  test("current and newer fetch only release metadata", async () => {
    for (const [current, tag, status] of [
      ["0.3.0", "v0.3.0", "current"],
      ["0.2.15", "v0.2.14", "newer"],
    ]) {
      const f = fixture(tag);
      const x = await target();
      await writeFile(join(x.dir, "bruv-claude-compat"), "existing connector");
      await expect(
        updateBruv(
          deps(f.fetch, x.path, { currentVersion: current, runBinary: async () => "bruv-claude-compat " + current }),
        ),
      ).resolves.toMatchObject({
        status,
      });
      expect(f.calls).toEqual([releaseUrl]);
    }
  });

  test("--check reports available without download or replacement", async () => {
    const x = await target();
    const f = fixture();
    expect(await updateBruv(deps(f.fetch, x.path, { check: true }))).toEqual({ status: "available", version: "0.3.0" });
    expect(f.calls).toEqual([releaseUrl]);
    expect(await readdir(x.dir)).toEqual(["bruv"]);
  });

  test.each(["missing", "mismatched", "broken"])("same stable version repairs %s connector", async (kind) => {
    const x = await target();
    const connector = join(x.dir, "bruv-claude-compat");
    if (kind !== "missing") await writeFile(connector, "old connector");
    const runBinary = async (path: string) => {
      if (path === connector) {
        if (kind === "broken") throw new Error("broken installed connector");
        return "bruv-claude-compat 0.2.0";
      }
      return path.endsWith("bruv-claude-compat") ? "bruv-claude-compat 0.3.0" : "0.3.0";
    };
    const f = fixture();
    const options = { currentVersion: "0.3.0", runBinary };
    expect(await updateBruv(deps(f.fetch, x.path, { ...options, check: true }))).toEqual({
      status: "available",
      version: "0.3.0",
    });
    expect(f.calls).toEqual([releaseUrl]);
    expect(await updateBruv(deps(f.fetch, x.path, options))).toMatchObject({ status: "updated" });
    expect(await readFile(connector, "utf8")).toBe("new compiled connector");
  });

  test("newer normal-only install never downgrades to add connector", async () => {
    const x = await target();
    await expect(updateBruv(deps(fixture().fetch, x.path, { currentVersion: "0.4.0" }))).rejects.toThrow(
      "no downgrade performed",
    );
    expect(await readFile(x.path, "utf8")).toBe("old");
  });

  test("installed old connector fallback is limited to unsupported product flag", async () => {
    const x = await target();
    const connector = join(x.dir, "bruv-claude-compat");
    await writeFile(
      connector,
      '#!/bin/sh\ncase "$1" in --version) echo "bruv-claude-compat 0.3.0";; *) exit 1;; esac\n',
      { mode: 0o755 },
    );
    const { runBinary: _mock, ...options } = deps(fixture().fetch, x.path, { currentVersion: "0.3.0" });
    expect(await updateBruv(options)).toEqual({ status: "current", version: "0.3.0" });
    const probes: string[] = [];
    expect(
      await updateBruv(
        deps(fixture().fetch, x.path, {
          currentVersion: "0.3.0",
          check: true,
          runBinary: async (_path: string, args: string[], env: NodeJS.ProcessEnv) => {
            expect(env.BRUV_CLAUDE_COMPAT_BRUV_PATH).toBeUndefined();
            probes.push(args[0]!);
            return args[0] === "--bruv-version" ? "0.2.0" : "bruv-claude-compat 0.3.0";
          },
        }),
      ),
    ).toEqual({ status: "available", version: "0.3.0" });
    expect(probes).toEqual(["--bruv-version"]);
  });

  test("installed launcher override cannot hide a mismatched sibling product", async () => {
    const x = await target();
    await writeFile(x.path, '#!/bin/sh\nif [ "$1" = claude-compat ]; then echo 0.2.0; else echo 0.3.0; fi\n', {
      mode: 0o755,
    });
    const launcher = await readFile(
      process.env.BRUV_TEST_LAUNCHER_TEMPLATE ?? new URL("../../scripts/build/bruv-claude-compat.sh", import.meta.url),
      "utf8",
    );
    await writeFile(join(x.dir, "bruv-claude-compat"), launcher, { mode: 0o755 });
    const healthy = join(x.dir, "unrelated-bruv");
    await writeFile(healthy, "#!/bin/sh\necho 0.3.0\n", { mode: 0o755 });
    const inherited = process.env.BRUV_CLAUDE_COMPAT_BRUV_PATH;
    process.env.BRUV_CLAUDE_COMPAT_BRUV_PATH = healthy;
    try {
      const { runBinary: _mock, ...options } = deps(fixture().fetch, x.path, { currentVersion: "0.3.0", check: true });
      expect(await updateBruv(options)).toEqual({ status: "available", version: "0.3.0" });
    } finally {
      if (inherited === undefined) delete process.env.BRUV_CLAUDE_COMPAT_BRUV_PATH;
      else process.env.BRUV_CLAUDE_COMPAT_BRUV_PATH = inherited;
    }
  });
});

describe("artifact download integrity", () => {
  test("binary downloads have a longer deadline than metadata and checksums", async () => {
    const x = await target();
    const timeout = spyOn(AbortSignal, "timeout");
    const f = fixture();
    const signals: (AbortSignal | null | undefined)[] = [];
    const fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal);
      return f.fetch(url, init);
    }) as typeof globalThis.fetch;
    try {
      await updateBruv(deps(fetch, x.path));
      expect(f.calls).toEqual([
        releaseUrl,
        root("v0.3.0") + "bruv-linux-x64",
        root("v0.3.0") + "bruv-linux-x64.sha256",
        root("v0.3.0") + "bruv-claude-compat-linux-x64",
        root("v0.3.0") + "bruv-claude-compat-linux-x64.sha256",
      ]);
      expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([300_000, 900_000, 300_000, 900_000, 300_000]);
      expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
    } finally {
      timeout.mockRestore();
    }
  });

  test.each(["request", "body"])(
    "download timeout during %s reports network phase and leaves pair unchanged",
    async (where) => {
      const x = await target();
      const connector = join(x.dir, "bruv-claude-compat");
      await writeFile(connector, "old connector");
      const f = fixture();
      const fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url) !== root("v0.3.0") + "bruv-linux-x64") return f.fetch(url, init);
        const error = new DOMException("The operation timed out.", "TimeoutError");
        if (where === "request") throw error;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(error);
            },
          }),
        );
      }) as typeof globalThis.fetch;
      let probes = 0;
      let replacements = 0;
      await expect(
        updateBruv(
          deps(fetch, x.path, {
            runBinary: async () => {
              probes++;
              return "0.3.0";
            },
            rename: async () => {
              replacements++;
            },
          }),
        ),
      ).rejects.toThrow(
        "Could not update Bruv pair (download and stage bruv-linux-x64): Unable to download bruv-linux-x64: The operation timed out.. Installed files unchanged.",
      );
      expect(await readFile(x.path, "utf8")).toBe("old");
      expect(await readFile(connector, "utf8")).toBe("old connector");
      expect((await readdir(x.dir)).sort()).toEqual(["bruv", "bruv-claude-compat"]);
      expect(probes).toBe(0);
      expect(replacements).toBe(0);
    },
  );

  test.each([
    ["wrong hash", { bruv: { checksum: "0".repeat(64), binaryBody: body } }, "Checksum verification failed"],
    ["malformed checksum", { bruv: { checksum: "not-a-sha" } }, "Checksum verification failed"],
    ["binary HTTP failure", { bruv: { binaryStatus: 503 } }, "Unable to download"],
    ["checksum HTTP failure", { bruv: { checksumStatus: 503 } }, "Checksum verification failed"],
  ])("rejects %s", async (_n, opts, msg) => {
    const x = await target();
    const f = fixture("v0.3.0", opts);
    await expect(updateBruv(deps(f.fetch, x.path))).rejects.toThrow(msg);
    expect(await Bun.file(x.path).text()).toBe("old");
  });

  test("rejects checksum with a filename that does not match the binary asset", async () => {
    const x = await target();
    const f = fixture("v0.3.0", { bruv: { checksumFile: "other-binary" } });
    await expect(updateBruv(deps(f.fetch, x.path))).rejects.toThrow("Checksum verification failed");
    expect(await Bun.file(x.path).text()).toBe("old");
  });

  test("truncated body fails checksum", async () => {
    const x = await target();
    const f = fixture("v0.3.0", { bruv: { binaryBody: body.slice(0, 3) } });
    await expect(updateBruv(deps(f.fetch, x.path))).rejects.toThrow("Checksum verification failed");
  });

  test.each([
    ["missing connector asset", { connector: { missingBinary: true } }],
    ["missing connector checksum asset", { connector: { missingChecksum: true } }],
    ["foreign connector checksum URL", { connector: { checksumUrl: "https://example.invalid/checksum" } }],
    ["wrong connector checksum filename", { connector: { checksumFile: "bruv-linux-x64" } }],
    ["bad connector checksum", { connector: { checksum: "0".repeat(64) } }],
    ["connector download failure", { connector: { binaryStatus: 503 } }],
  ])("%s preserves both installed binaries", async (_label, options) => {
    const x = await target();
    const connector = join(x.dir, "bruv-claude-compat");
    await writeFile(connector, "old connector", { mode: 0o751 });
    await expect(updateBruv(deps(fixture("v0.3.0", options).fetch, x.path))).rejects.toThrow();
    expect(await readFile(x.path, "utf8")).toBe("old");
    expect(await readFile(connector, "utf8")).toBe("old connector");
    expect((await readdir(x.dir)).filter((n) => n.startsWith(".bruv-update-"))).toEqual([]);
  });
});

describe("staged pair verification", () => {
  test("wrong staged normal version prevents paired replacement", async () => {
    const x = await target();
    await expect(
      updateBruv(
        deps(fixture().fetch, x.path, {
          runBinary: async () => "0.2.15",
        }),
      ),
    ).rejects.toThrow("version mismatch");
    expect(await readFile(x.path, "utf8")).toBe("old");
    expect(await Bun.file(join(x.dir, "bruv-claude-compat")).exists()).toBe(false);
  });

  test.each(["0.2.0", "Bruv connector"])("bad staged connector version %s prevents replacement", async (output) => {
    const x = await target();
    await expect(
      updateBruv(
        deps(fixture().fetch, x.path, {
          runBinary: async (path: string) => (path.endsWith("bruv-claude-compat") ? output : "0.3.0"),
        }),
      ),
    ).rejects.toThrow("version mismatch");
    expect(await readFile(x.path, "utf8")).toBe("old");
    expect(await Bun.file(join(x.dir, "bruv-claude-compat")).exists()).toBe(false);
  });

  test("macOS staged helper check failure preserves the installation", async () => {
    const x = await target();
    const probes: string[] = [];
    await expect(
      updateBruv(
        deps(fixture("v0.3.0", { asset: "bruv-darwin-arm64" }).fetch, x.path, {
          platform: "darwin",
          arch: "arm64",
          runBinary: async (path: string, args: string[]) => {
            probes.push(args[0]!);
            if (args[0] === "--live-self-test") throw new Error("helper broken");
            return path.endsWith("bruv-claude-compat") ? "bruv-claude-compat 0.3.0" : "0.3.0";
          },
        }),
      ),
    ).rejects.toThrow("helper broken");
    expect(probes).toEqual(["--version", "--bruv-version", "--live-self-test"]);
    expect(await readFile(x.path, "utf8")).toBe("old");
  });

  test("staged launcher is explicitly paired with candidate normal, not caller override", async () => {
    const x = await target();
    const probes: { path: string; flag: string; env: NodeJS.ProcessEnv }[] = [];
    const inherited = process.env.BRUV_CLAUDE_COMPAT_BRUV_PATH;
    process.env.BRUV_CLAUDE_COMPAT_BRUV_PATH = "/wrong-installed-bruv";
    try {
      await updateBruv(
        deps(fixture().fetch, x.path, {
          runBinary: async (path: string, args: string[], env: NodeJS.ProcessEnv) => {
            probes.push({ path, flag: args[0]!, env });
            return path.endsWith("bruv-claude-compat") ? "bruv-claude-compat 0.3.0" : "0.3.0";
          },
        }),
      );
      expect(probes.map((p) => p.flag)).toEqual(["--version", "--bruv-version"]);
      expect(probes[0]!.env.BRUV_CLAUDE_COMPAT_BRUV_PATH).toBeUndefined();
      expect(probes[1]!.env.BRUV_CLAUDE_COMPAT_BRUV_PATH).toBe(probes[0]!.path);
    } finally {
      if (inherited === undefined) delete process.env.BRUV_CLAUDE_COMPAT_BRUV_PATH;
      else process.env.BRUV_CLAUDE_COMPAT_BRUV_PATH = inherited;
    }
  });
});

describe("pair publication and recovery", () => {
  test("verified pair and both backups precede connector-first publication", async () => {
    const x = await target();
    const connector = join(x.dir, "bruv-claude-compat");
    await writeFile(connector, "old connector");
    const f = fixture();
    const events: string[] = [];
    const fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      events.push("fetch:" + String(url).split("/").at(-1));
      return f.fetch(url, init);
    }) as typeof globalThis.fetch;
    await updateBruv(
      deps(fetch, x.path, {
        onDownload: (version: string) => events.push("download:" + version),
        runBinary: async (path: string, args: string[]) => {
          events.push("probe:" + basename(path) + ":" + args.join(" "));
          expect(await readFile(x.path, "utf8")).toBe("old");
          expect(await readFile(connector, "utf8")).toBe("old connector");
          return basename(path) === "bruv" ? "0.3.0" : "bruv-claude-compat 0.3.0";
        },
        rename: async (from, to) => {
          events.push("replace:" + basename(String(to)));
          const stage = dirname(String(from));
          expect(await readFile(join(stage, "bruv.previous"), "utf8")).toBe("old");
          expect(await readFile(join(stage, "bruv-claude-compat.previous"), "utf8")).toBe("old connector");
          await rename(from, to);
        },
      }),
    );
    expect(events).toEqual([
      "fetch:latest",
      "download:0.3.0",
      "fetch:bruv-linux-x64",
      "fetch:bruv-linux-x64.sha256",
      "fetch:bruv-claude-compat-linux-x64",
      "fetch:bruv-claude-compat-linux-x64.sha256",
      "probe:bruv:--version",
      "probe:bruv-claude-compat:--bruv-version",
      "replace:bruv-claude-compat",
      "replace:bruv",
    ]);
    expect((await readdir(x.dir)).sort()).toEqual(["bruv", "bruv-claude-compat"]);
  });

  test("concurrent target change aborts commit", async () => {
    const x = await target();
    const f = fixture("v0.3.0", { beforeBruvChecksum: () => writeFile(x.path, "changed") });
    await expect(updateBruv(deps(f.fetch, x.path))).rejects.toThrow();
    expect(await Bun.file(x.path).text()).toBe("changed");
    expect((await readdir(x.dir)).filter((name) => name.startsWith(".bruv-update-"))).toEqual([]);
  });

  test("connector created concurrently is not overwritten", async () => {
    const x = await target();
    const connector = join(x.dir, "bruv-claude-compat");
    const f = fixture("v0.3.0", { beforeBruvChecksum: () => writeFile(connector, "concurrent connector") });
    await expect(updateBruv(deps(f.fetch, x.path))).rejects.toThrow("changed during the update");
    expect(await readFile(connector, "utf8")).toBe("concurrent connector");
    expect(await readFile(x.path, "utf8")).toBe("old");
  });

  test("first replacement failure leaves both files unchanged", async () => {
    const x = await target();
    const connector = join(x.dir, "bruv-claude-compat");
    await writeFile(connector, "old connector");
    await expect(
      updateBruv(
        deps(fixture().fetch, x.path, {
          rename: async () => {
            throw new Error("injected replacement failure");
          },
        }),
      ),
    ).rejects.toThrow(
      "Could not update Bruv pair (replace installed bruv-claude-compat): injected replacement failure. Installed files unchanged.",
    );
    expect(await readFile(x.path, "utf8")).toBe("old");
    expect(await readFile(connector, "utf8")).toBe("old connector");
  });

  test.each([false, true])("second replacement fails; rolls back (existing connector: %s)", async (existing) => {
    const x = await target();
    const connector = join(x.dir, "bruv-claude-compat");
    if (existing) await writeFile(connector, "old connector", { mode: 0o751 });
    const move: typeof rename = async (from, to) => {
      if (to === x.path) throw new Error("injected normal replacement failure");
      await rename(from, to);
    };
    await expect(updateBruv(deps(fixture().fetch, x.path, { rename: move }))).rejects.toThrow(
      "Previous installation restored",
    );
    expect(await readFile(x.path, "utf8")).toBe("old");
    expect(await Bun.file(connector).exists()).toBe(existing);
    if (existing) {
      expect(await readFile(connector, "utf8")).toBe("old connector");
      expect((await stat(connector)).mode & 0o777).toBe(0o751);
    }
    expect((await readdir(x.dir)).filter((n) => n.startsWith(".bruv-update-"))).toEqual([]);
  });

  test("rollback failure retains backups and reports recovery path", async () => {
    const x = await target();
    const connector = join(x.dir, "bruv-claude-compat");
    await writeFile(connector, "old connector");
    let moves = 0;
    const move: typeof rename = async (from, to) => {
      if (++moves > 1) throw new Error("injected replacement/rollback failure");
      await rename(from, to);
    };
    let message = "";
    try {
      await updateBruv(deps(fixture().fetch, x.path, { rename: move }));
    } catch (error) {
      message = (error as Error).message;
    }
    const recovery = (await readdir(x.dir)).find((n) => n.startsWith(".bruv-update-"))!;
    expect(message).toContain("Rollback failed");
    expect(message).toContain(join(x.dir, recovery));
    expect(message).toContain("Do not treat this install as updated");
    expect(await readFile(join(x.dir, recovery, "bruv.previous"), "utf8")).toBe("old");
    expect(await readFile(join(x.dir, recovery, "bruv-claude-compat.previous"), "utf8")).toBe("old connector");
    expect(await readFile(x.path, "utf8")).toBe("old");
  });
});

// Compiled fixtures retain their owned roots for inspection, outside the unit-test cleanup set.
describe("private compiled updater integration", () => {
  test("real private compiled Bun fixture is accepted and lookalikes are rejected", async () => {
    expect(isCompiledInvocation("file:///tmp/$bunfs/source.ts")).toBe(false);
    expect(isCompiledInvocation("file:///project-$bunfs/source.ts")).toBe(false);
    const dir = await mkdtemp("/var/tmp/bruv-compiled-fixture-");
    const env = ownedFixtureEnv(dir);
    const out = join(dir, "fixture");
    const build = Bun.spawn(
      [
        process.execPath,
        "build",
        "--compile",
        join(import.meta.dir, "../helpers/compiled-bun-fixture.ts"),
        "--outfile",
        out,
      ],
      { cwd: dir, env, stdout: "ignore", stderr: "pipe" },
    );
    expect(await build.exited).toBe(0);
    const run = Bun.spawn([out], {
      cwd: dir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const result = JSON.parse(await new Response(run.stdout).text());
    expect(result.url.startsWith("file:///$bunfs/")).toBe(true);
    expect(result.url.endsWith("/fixture")).toBe(true);
    expect(result.compiled).toBe(true);
    expect(await run.exited).toBe(0);
  }, 30_000);

  test("compiled updater verifies staged distinct versions and updates a non-running temporary pair", async () => {
    const dir = await mkdtemp("/var/tmp/bruv-update-compiled-");
    const x = { dir, path: join(dir, "bruv") };
    const env = ownedFixtureEnv(dir);
    await writeFile(x.path, "old", { mode: 0o754 });
    const runner = join(x.dir, "updater-runner");
    const normalPayload = join(x.dir, "normal-payload");
    const connectorPayload = join(x.dir, "connector-payload");
    const normal = "#!/bin/sh\necho 0.3.0\n";
    const connector =
      '#!/bin/sh\nif [ "$1" = --bruv-version ]; then product=$("${BRUV_CLAUDE_COMPAT_BRUV_PATH:-$(dirname "$0")/bruv}" --version); printf "bruv-claude-compat %s\\n" "$product"; exit; fi\necho "Bruv connector"\n';
    await writeFile(normalPayload, normal);
    await writeFile(connectorPayload, connector);
    const build = Bun.spawn(
      [process.execPath, "build", "--compile", join(import.meta.dir, "update-self-fixture.ts"), "--outfile", runner],
      { cwd: dir, env, stdout: "ignore", stderr: "pipe" },
    );
    const errors = await new Response(build.stderr).text();
    expect(await build.exited, errors).toBe(0);
    const runnerBytes = await readFile(runner);
    const child = Bun.spawn([runner], {
      cwd: dir,
      env: {
        ...env,
        PATH: "/nonexistent",
        BRUV_TEST_UPDATE_TARGET: x.path,
        BRUV_TEST_UPDATE_PAYLOAD: normalPayload,
        BRUV_TEST_UPDATE_CONNECTOR_PAYLOAD: connectorPayload,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [output, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, stderr).toBe(0);
    expect(JSON.parse(output)).toEqual({ status: "updated", version: "0.3.0", path: x.path });
    expect(await readFile(x.path, "utf8")).toBe(normal);
    expect(await readFile(join(x.dir, "bruv-claude-compat"), "utf8")).toBe(connector);
    expect(await readFile(runner)).toEqual(runnerBytes);
    for (const [path, version] of [
      [x.path, "0.3.0"],
      [join(x.dir, "bruv-claude-compat"), "Bruv connector"],
    ]) {
      const check = Bun.spawn([path!, "--version"], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
      expect((await new Response(check.stdout).text()).trim()).toBe(version!);
      expect(await check.exited).toBe(0);
    }
    expect((await readdir(x.dir)).filter((name) => name.startsWith(".bruv-update-"))).toEqual([]);
  }, 30_000);
});
