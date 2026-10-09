import { scrubT3BridgeEnvironment } from "../delegation-environment";
import { spawn } from "node:child_process";
import type { Transport } from "./client";

export const validHost = (host: string) => /^[a-zA-Z0-9_][a-zA-Z0-9_.@-]*$/.test(host) && !host.startsWith("-");
export const validPath = (path: string) => path === "bruv" || (path.startsWith("/") && !/[\r\n\0]/.test(path));
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;

/** One SSH stdio invocation per operation. SSH's remote command is a shell string: quote only the executable. */
export async function sshControl<T>(
  entrypoint: "--remote-control" | "--remote-root-control",
  host: string,
  bruvPath: string,
  request: unknown,
): Promise<T> {
  if (!validHost(host) || !validPath(bruvPath)) throw new Error("Invalid SSH alias or remote bruv path");
  return await new Promise<T>((resolve, reject) => {
    const child = spawn(
      "ssh",
      [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "UpdateHostKeys=no",
        "-o",
        "ClearAllForwardings=yes",
        "-o",
        "ForwardAgent=no",
        "-o",
        "ForwardX11=no",
        "-o",
        "GSSAPIDelegateCredentials=no",
        "-o",
        "PermitLocalCommand=no",
        "--",
        host,
        `${quote(bruvPath)} ${entrypoint}`,
      ],
      { env: scrubT3BridgeEnvironment(process.env), stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "",
      err = "",
      bytes = 0;
    let failure: Error | undefined;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const abort = (message: string) => {
      if (failure) return;
      failure = new Error(message);
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
      forceTimer.unref();
    };
    const timer = setTimeout(() => abort("SSH remote control timed out; outcome unknown"), 30_000);
    const cleanup = () => {
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (s: string) => {
      if (failure) return;
      bytes += Buffer.byteLength(s);
      if (bytes > 4_000_000) return abort("SSH remote control response exceeds 4 MB limit; outcome unknown");
      out += s;
    });
    child.stderr.on("data", (s: string) => {
      err += s;
      if (err.length > 4000) err = err.slice(-4000);
    });
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      cleanup();
      if (failure) return reject(failure);
      if (code !== 0) return reject(new Error(`SSH remote control failed: ${err.trim() || `exit ${code}`}`));
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error("Remote bruv returned no protocol JSON; use a compatible remote-enabled Linux build"));
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

export const sshTransport: Transport = (host, bruvPath, request) =>
  sshControl("--remote-control", host, bruvPath, request);
