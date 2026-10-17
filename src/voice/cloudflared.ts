import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** cloudflared on PATH, or the copy bruv downloaded. */
export function findCloudflared(dir: string) {
  const own = join(dir, "cloudflared");
  if (existsSync(own)) return own;
  return spawnSync("cloudflared", ["--version"], { stdio: "ignore" }).status === 0 ? "cloudflared" : undefined;
}

/** Cloudflare's release file for this machine; macOS builds come zipped. */
export function release(platform = process.platform, arch = process.arch) {
  const cpu = { x64: "amd64", arm64: "arm64", arm: "arm", ia32: "386" }[arch as string];
  if (!cpu) return undefined;
  if (platform === "linux") return { name: `cloudflared-linux-${cpu}`, packed: false };
  if (platform === "darwin" && (cpu === "amd64" || cpu === "arm64"))
    return { name: `cloudflared-darwin-${cpu}.tgz`, packed: true };
  return undefined;
}

/** Downloads cloudflared from its GitHub releases into `dir`. */
export async function downloadCloudflared(dir: string, fetch = globalThis.fetch) {
  const file = release();
  if (!file) throw new Error("No cloudflared download for this machine; install it from Cloudflare's site.");
  const response = await fetch(`https://github.com/cloudflare/cloudflared/releases/latest/download/${file.name}`);
  if (!response.ok) throw new Error(`Download of cloudflared failed: HTTP ${response.status}`);
  mkdirSync(dir, { recursive: true });
  const partial = join(dir, `.partial-${file.name}`);
  writeFileSync(partial, Buffer.from(await response.arrayBuffer()));
  const binary = join(dir, "cloudflared");
  if (file.packed) {
    const unpacked = spawnSync("tar", ["xzf", partial, "-C", dir, "cloudflared"]);
    rmSync(partial);
    if (unpacked.status !== 0) throw new Error("Could not unpack cloudflared.");
  } else {
    renameSync(partial, binary);
  }
  chmodSync(binary, 0o755);
  return binary;
}

/**
 * Runs the tunnel and resolves once Cloudflare has a connection to it. The token goes in the environment,
 * where other users' `ps` can't read it.
 */
export function runTunnel(
  binary: string,
  token: string,
  onExit: (message: string) => void = () => {},
): Promise<{ stop(): void }> {
  const child = spawn(binary, ["tunnel", "--no-autoupdate", "run"], {
    env: { ...process.env, TUNNEL_TOKEN: token },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stopped = false;
  let connected = false;
  const stop = () => {
    stopped = true;
    child.kill();
  };
  return new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => fail(new Error("cloudflared did not connect within 30 seconds.")), 30_000);
    const fail = (error: Error) => {
      clearTimeout(timer);
      stop();
      reject(error);
    };
    child.stderr?.on("data", (chunk: Buffer) => {
      log = (log + chunk.toString()).slice(-2000);
      if (log.includes("Registered tunnel connection")) {
        clearTimeout(timer);
        connected = true;
        resolve({ stop });
      }
    });
    child.on("error", fail);
    child.on("exit", (code) => {
      const message = `cloudflared stopped (${code}): ${log.trim().split("\n").at(-1) ?? ""}`;
      if (!connected) fail(new Error(message));
      else if (!stopped) onExit(message);
    });
  });
}
