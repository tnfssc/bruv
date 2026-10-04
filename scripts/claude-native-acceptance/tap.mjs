#!/usr/bin/node
// Transparent process tap. All native packets originate in the actual connector.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
const config = JSON.parse(fs.readFileSync(process.env.BRUV_ACCEPTANCE_CONFIG, "utf8"));
const isWorker = config.delegationCases && process.argv[1] === config.workerTap;
const instance = isWorker ? "normal" : "root";
const instanceEnv = isWorker ? { ...process.env, ...config.workerEnv } : process.env;
const log = (kind, value) =>
  fs.appendFileSync(config.wire, JSON.stringify({ kind, instance, owner: child.pid, value }) + "\n", { mode: 0o600 });
const child = spawn(config.connector, [...config.connectorArgs, ...process.argv.slice(2)], {
  env: instanceEnv,
  stdio: ["pipe", "pipe", "pipe"],
});
log("lifecycle", {
  event: "spawn",
  pid: child.pid,
  flags: process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => a.split("=")[0]),
});
if (config.delegationCases) {
  const args = process.argv.slice(2),
    pos = args.indexOf("--mcp-config");
  const argument = (name) => {
    const p = args.indexOf(name);
    return p >= 0 ? args[p + 1] : args.find((a) => a.startsWith(name + "="))?.slice(name.length + 1);
  };
  const injection = pos >= 0 ? JSON.parse(args[pos + 1])?.mcpServers?.["t3-code"] : undefined;
  const token = injection?.headers?.Authorization;
  log("scope", {
    instance,
    hasCredential: !!token,
    credentialDigest: token ? createHash("sha256").update(token).digest("hex") : null,
    effort: argument("--effort"),
    thinking: argument("--thinking"),
    model: argument("--model"),
    role: instanceEnv.BRUV_SUBAGENT_TYPE,
    depth: instanceEnv.BRUV_SUBAGENT_DEPTH,
  });
}
let errors = "";
child.stderr.on("data", (b) => {
  process.stderr.write(b);
  errors += b;
  for (let p; (p = errors.indexOf("\n")) >= 0; ) {
    const line = errors.slice(0, p);
    errors = errors.slice(p + 1);
    if (
      config.delegationCases ||
      /^\[bruv-claude-compat\] (?:--[A-Za-z-]+ .*not yet bound|Unsupported permission mode:|No configured Bruv model|No configured authentication|Unknown connector option: --[A-Za-z-]+$|Question belongs to another branch; history only$|Native question frontend is not bound to a parent session$|Unsupported --settings effect: [A-Za-z]+$|--[A-Za-z-]+ is not supported|Native session\/message ID must be a UUID)/.test(
        line,
      )
    )
      log("diagnostic", { error: line.replaceAll(pathRoot(config), "<FIXTURE>") });
  }
});
function pathRoot(c) {
  return c.state.slice(0, c.state.lastIndexOf("/"));
}
function tap(input, output, kind) {
  let buffer = "";
  input.on("data", (b) => {
    output.write(b);
    buffer += b.toString();
    for (let p; (p = buffer.indexOf("\n")) >= 0; ) {
      const line = buffer.slice(0, p);
      buffer = buffer.slice(p + 1);
      if (line) {
        try {
          log(kind, JSON.parse(line));
        } catch {
          log(kind, { unparsed: true });
        }
      }
    }
  });
}
tap(process.stdin, child.stdin, "stdin");
tap(child.stdout, process.stdout, "stdout");
process.stdin.on("end", () => child.stdin.end());
child.stdin.on("error", () => {});
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
child.on("error", (e) => {
  log("lifecycle", { event: "error", message: e.message });
  process.exitCode = 1;
});
child.on("close", (code, signal) => {
  log("lifecycle", { event: "exit", code, signal });
  process.exit(code ?? 1);
});
