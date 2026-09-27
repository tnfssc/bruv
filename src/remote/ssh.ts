import { spawn } from "node:child_process";
import type { Transport } from "./client";

export const validHost = (host: string) => /^[a-zA-Z0-9_][a-zA-Z0-9_.@-]*$/.test(host) && !host.startsWith("-");
export const validPath = (path: string) => path === "die" || (path.startsWith("/") && !/[\r\n\0]/.test(path));
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";

/** One SSH stdio invocation per operation. SSH's remote command is a shell string: quote only the executable. */
export const sshTransport: Transport = async (host, diePath, request) => {
  if (!validHost(host) || !validPath(diePath)) throw new Error("Invalid SSH alias or remote die path");
  return await new Promise((resolve, reject) => {
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
        quote(diePath) + " --remote-control",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "", err = "", bytes = 0;
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
    const cleanup = () => { clearTimeout(timer); if (forceTimer) clearTimeout(forceTimer); };
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
      if (code !== 0) return reject(new Error("SSH remote control failed: " + (err.trim() || "exit " + code)));
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error("Remote die returned no protocol JSON; use a compatible remote-enabled Linux build"));
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(request) + "\n");
  });
};
