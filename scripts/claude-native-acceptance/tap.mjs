#!/usr/bin/node
// Transparent process tap. All native packets originate in the actual connector.
import fs from "node:fs";
import { spawn } from "node:child_process";
const config = JSON.parse(fs.readFileSync(process.env.BRUV_ACCEPTANCE_CONFIG, "utf8"));
const log = (kind, value) => fs.appendFileSync(config.wire, JSON.stringify({ kind, value }) + "\n", { mode: 0o600 });
const child = spawn(config.connector, [...config.connectorArgs, ...process.argv.slice(2)], {
  env: process.env,
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
let errors = "";
child.stderr.on("data", (b) => {
  process.stderr.write(b);
  errors += b;
  for (let p; (p = errors.indexOf("\n")) >= 0; ) {
    const line = errors.slice(0, p);
    errors = errors.slice(p + 1);
    if (
      /^\[bruv-claude-compat\] (?:--[A-Za-z-]+ .*not yet bound|Unsupported permission mode:|No configured Bruv model|No configured authentication)/.test(
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
