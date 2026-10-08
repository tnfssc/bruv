import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type DownloadProgress, RELEASES_URL, updateBruv } from "../../src/update";
import { createDownloadProgressDisplay, formatDownloadProgress } from "../../src/update-progress";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const payload = new Uint8Array([1, 2, 3, 4, 5, 6]);
const asset = "bruv-linux-x64";
const connector = "bruv-claude-compat-linux-x64";
const base = "https://github.com/tnfssc/bruv/releases/download/v0.3.0/";

async function fixture(
  options: {
    size?: unknown;
    length?: string;
    failure?: boolean;
    badChecksum?: boolean;
    beforeSecondChunk?: () => Promise<void>;
  } = {},
) {
  const dir = await mkdtemp("/var/tmp/bruv-update-progress-");
  dirs.push(dir);
  const executable = join(dir, "bruv");
  await writeFile(executable, "old", { mode: 0o755 });
  const events: DownloadProgress[] = [];
  const calls: string[] = [];
  const streams: ReadableStream<Uint8Array>[] = [];
  let cancelled = false;
  const http = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (url === RELEASES_URL)
      return Response.json({
        tag_name: "v0.3.0",
        assets: [asset, connector].flatMap((name) => [
          { name, browser_download_url: base + name, size: options.size },
          { name: name + ".sha256", browser_download_url: base + name + ".sha256" },
        ]),
      });
    const name = url.slice(base.length);
    if (name.endsWith(".sha256")) {
      // The live line must be finished before checksum validation starts.
      expect(events.at(-1)?.status).toBe("complete");
      const hash = createHash("sha256")
        .update(options.badChecksum ? new Uint8Array([0]) : payload)
        .digest("hex");
      return new Response(hash + "  " + name.slice(0, -7) + "\n");
    }
    expect([asset, connector]).toContain(name);
    let index = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (index === 1) await options.beforeSecondChunk?.();
        if (index === 0) controller.enqueue(payload.slice(0, 2));
        else if (options.failure) controller.error(new DOMException("download aborted", "AbortError"));
        else if (index === 1) controller.enqueue(payload.slice(2, 5));
        else if (index === 2) controller.enqueue(payload.slice(5));
        else controller.close();
        index++;
      },
      cancel() {
        cancelled = true;
      },
    });
    streams.push(stream);
    return new Response(stream, { headers: options.length === undefined ? {} : { "content-length": options.length } });
  }) as typeof fetch;
  const deps = {
    compiled: true,
    executable,
    currentVersion: "0.2.15",
    platform: "linux" as const,
    arch: "x64",
    fetch: http,
    runBinary: async (path: string) => (path.endsWith("bruv-claude-compat") ? "bruv-claude-compat 0.3.0" : "0.3.0"),
    onDownloadProgress: (event: DownloadProgress) => {
      events.push(event);
    },
  };
  return { dir, executable, deps, events, calls, streams, cancelled: () => cancelled };
}

describe("streamed update download progress", () => {
  test("reports actual incremental bytes for both assets and finishes before checksums", async () => {
    const f = await fixture({ size: 99, length: "6" });
    const versions: string[] = [];
    const lines: string[] = [];
    const display = createDownloadProgressDisplay({ isTTY: false, write: (text) => lines.push(text) });
    const result = await updateBruv({
      ...f.deps,
      onDownload: (v) => versions.push(v),
      onDownloadProgress: (event) => {
        f.deps.onDownloadProgress(event);
        display.onProgress(event);
      },
    });
    expect(result.status).toBe("updated");
    expect(versions).toEqual(["0.3.0"]);
    for (const name of [asset, connector]) {
      const events = f.events.filter((event) => event.asset === name);
      expect(events.map((event) => event.downloadedBytes)).toEqual([0, 2, 5, 6, 6]);
      expect(events.map((event) => event.status)).toEqual([
        "downloading",
        "downloading",
        "downloading",
        "downloading",
        "complete",
      ]);
      expect(events.slice(1).every((event) => event.totalBytes === 6)).toBe(true);
      expect(events.every((event, i) => event.elapsedMs >= (events[i - 1]?.elapsedMs ?? 0))).toBe(true);
    }
    expect(lines.join("")).toContain("Downloaded bruv-linux-x64 6 B / 6 B (100%)");
    expect(lines.join("")).toContain("Downloaded bruv-claude-compat-linux-x64");
    expect(lines.join("")).not.toContain("\x1b");
    expect(await Bun.file(f.executable).bytes()).toEqual(payload);
    expect(await Bun.file(join(f.dir, "bruv-claude-compat")).bytes()).toEqual(payload);
    expect((await readdir(f.dir)).sort()).toEqual(["bruv", "bruv-claude-compat"]);
    expect(f.streams.every((stream) => !stream.locked)).toBe(true);
  });

  test("delivers byte events while the remaining body is still pending", async () => {
    let resume!: () => void;
    let resumed = false;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const f = await fixture({ beforeSecondChunk: () => gate });
    await updateBruv({
      ...f.deps,
      onDownloadProgress: (event) => {
        f.deps.onDownloadProgress(event);
        if (!resumed && event.downloadedBytes === 2) {
          expect(event.status).toBe("downloading");
          expect(f.calls).toEqual([RELEASES_URL, base + asset]);
          resumed = true;
          resume();
        }
      },
    });
    expect(resumed).toBe(true);
  });

  test.each([
    [{ size: 6 }, 6],
    [{ size: 6, length: "invalid" }, 6],
    [{ size: "6" }, undefined],
    [{ size: -1 }, undefined],
    [{}, undefined],
  ])("uses only valid optional size hints: %j", async (options, expected) => {
    const f = await fixture(options);
    await updateBruv(f.deps);
    expect(f.events.every((event) => event.totalBytes === expected)).toBe(true);
    expect(f.events.some((event) => event.downloadedBytes === 2)).toBe(true);
  });

  test("stream abort reports received bytes, releases reader, cleans staging and preserves install", async () => {
    const f = await fixture({ failure: true, length: "6" });
    const lines: string[] = [];
    const display = createDownloadProgressDisplay({ isTTY: true, write: (text) => lines.push(text) });
    await expect(
      updateBruv({
        ...f.deps,
        onDownloadProgress: (event) => {
          f.deps.onDownloadProgress(event);
          display.onProgress(event);
        },
      }),
    ).rejects.toThrow("download aborted");
    expect(f.events.at(-1)).toMatchObject({ status: "failed", downloadedBytes: 2 });
    expect(lines.join("")).toContain("Download failed: bruv-linux-x64 2 B / 6 B (33%)");
    expect(lines.at(-1)).toBe("\n");
    expect(f.calls).toEqual([RELEASES_URL, base + asset]);
    expect(f.streams[0]?.locked).toBe(false);
    expect(await Bun.file(f.executable).text()).toBe("old");
    expect(await readdir(f.dir)).toEqual(["bruv"]);
  });

  test("consumer failure cancels unread body and releases reader", async () => {
    const f = await fixture();
    await expect(
      updateBruv({
        ...f.deps,
        onDownloadProgress: (event) => {
          if (event.status === "downloading" && event.downloadedBytes) throw new Error("output failed");
        },
      }),
    ).rejects.toThrow("output failed");
    expect(f.cancelled()).toBe(true);
    expect(f.streams[0]?.locked).toBe(false);
    expect(await Bun.file(f.executable).text()).toBe("old");
    expect(await readdir(f.dir)).toEqual(["bruv"]);
  });

  test("completion is a body boundary, not permission to skip checksum validation", async () => {
    const f = await fixture({ badChecksum: true });
    await expect(updateBruv(f.deps)).rejects.toThrow("download does not match the release SHA256");
    expect(f.events.at(-1)?.status).toBe("complete");
    expect(await Bun.file(f.executable).text()).toBe("old");
    expect(await readdir(f.dir)).toEqual(["bruv"]);
  });

  test("check-only does not emit download progress", async () => {
    const f = await fixture();
    expect(await updateBruv({ ...f.deps, check: true })).toMatchObject({ status: "available" });
    expect(f.events).toEqual([]);
    expect(f.calls).toEqual([RELEASES_URL]);
  });
});

function event(extra: Partial<DownloadProgress> = {}): DownloadProgress {
  return {
    asset,
    downloadedBytes: 1024 * 1024,
    totalBytes: 4 * 1024 * 1024,
    elapsedMs: 2000,
    status: "downloading",
    ...extra,
  };
}

describe("user-visible update download display", () => {
  test("known size shows asset, bytes, percent, average speed and ETA", () => {
    expect(formatDownloadProgress(event())).toBe(
      "Downloading bruv-linux-x64 1.0 MiB / 4.0 MiB (25%) · 512.0 KiB/s · ETA 6s",
    );
    expect(formatDownloadProgress(event({ downloadedBytes: 7376878, totalBytes: 92476896, elapsedMs: 120000 }))).toBe(
      "Downloading bruv-linux-x64 7.0 MiB / 88.2 MiB (7%) · 60.0 KiB/s · ETA 23m 5s",
    );
  });
  test("unknown size omits percent and ETA; zero bytes omits made-up speed", () => {
    expect(formatDownloadProgress(event({ totalBytes: undefined }))).toBe(
      "Downloading bruv-linux-x64 1.0 MiB · 512.0 KiB/s",
    );
    expect(formatDownloadProgress(event({ totalBytes: undefined, downloadedBytes: 0, elapsedMs: 0 }))).toBe(
      "Downloading bruv-linux-x64 0 B",
    );
    expect(formatDownloadProgress(event({ status: "complete" }))).not.toContain("ETA");
  });
  test("TTY throttles one live line and terminates it before next phase or failure", () => {
    const writes: string[] = [];
    const display = createDownloadProgressDisplay({ isTTY: true, columns: 80, write: (text) => writes.push(text) });
    display.onProgress(event({ elapsedMs: 0, downloadedBytes: 0 }));
    display.onProgress(event({ elapsedMs: 50 }));
    expect(writes).toHaveLength(1);
    display.onProgress(event({ elapsedMs: 100 }));
    expect(writes).toHaveLength(2);
    expect(writes.every((text) => text.startsWith("\r\x1b[2K") && !text.includes("\n"))).toBe(true);
    display.onProgress(event({ elapsedMs: 101, status: "complete" }));
    expect(writes.at(-1)).toBe("\n");
    display.finish();
    expect(writes.filter((text) => text === "\n")).toHaveLength(1);
    display.onProgress(event({ asset: connector }));
    display.finish();
    expect(writes.at(-1)).toBe("\n");
  });
  test("non-TTY prints occasional readable lines with no control sequences", () => {
    const writes: string[] = [];
    const display = createDownloadProgressDisplay({ isTTY: false, write: (text) => writes.push(text) });
    for (let elapsedMs = 0; elapsedMs <= 20000; elapsedMs += 100) display.onProgress(event({ elapsedMs }));
    expect(writes).toHaveLength(3);
    display.onProgress(event({ elapsedMs: 20001, status: "failed" }));
    display.finish();
    expect(writes).toHaveLength(4);
    expect(writes.every((text) => text.endsWith("\n") && !text.includes("\x1b") && !text.includes("\r"))).toBe(true);
    expect(writes.at(-1)).toStartWith("Download failed: ");
  });
  test("terminal width shortens the asset first and avoids wrapping", () => {
    const line = formatDownloadProgress(event(), 80);
    expect(line.length).toBeLessThan(80);
    expect(line).toContain("1.0 MiB / 4.0 MiB (25%) · 512.0 KiB/s · ETA 6s");
    expect(formatDownloadProgress(event(), 30).length).toBeLessThan(30);
  });
});
