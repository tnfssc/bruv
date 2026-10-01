/** Fixture-only fault: deliver real SSH command, then discard its successful reply. */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export function shouldDrop(request: any): boolean {
  return (
    request?.op === "command" && request.command?.kind === "prompt" && request.command.text.includes("ROOT_REPLY_LOSS")
  );
}
export function runRelay(ssh: string, config: string, dir: string, args: string[]): number {
  if (!args.some((a) => a.includes("--remote-root-control"))) {
    const r = spawnSync(ssh, ["-F", config, ...args], { stdio: "inherit" });
    return r.status ?? 1;
  }
  const input = readFileSync(0, "utf8");
  const request = JSON.parse(input);
  appendFileSync(join(dir, "requests.jsonl"), JSON.stringify(request) + "\n");
  const lost = join(dir, "lost.json"),
    gate = join(dir, "armed");
  // Keep the saved local receipt genuinely unknown until the test explicitly releases it.
  if (
    existsSync(gate) &&
    existsSync(lost) &&
    request.op === "command-status" &&
    request.commandId === JSON.parse(readFileSync(lost, "utf8")).request.commandId
  ) {
    process.stderr.write("fixture reply-loss status gate\n");
    return 255;
  }
  const r = spawnSync(ssh, ["-F", config, ...args], { input, encoding: "utf8", maxBuffer: 4_000_000 });
  if (r.status === 0 && existsSync(gate) && !existsSync(lost) && shouldDrop(request)) {
    const response = JSON.parse(r.stdout); // Never fake successful delivery.
    writeFileSync(lost, JSON.stringify({ request, response }), { mode: 0o600 });
    process.stderr.write("fixture discarded actual SSH command reply\n");
    return 255;
  }
  process.stdout.write(r.stdout ?? "");
  process.stderr.write(r.stderr ?? "");
  return r.status ?? 1;
}
if (import.meta.main) {
  const [ssh, config, dir, ...args] = process.argv.slice(2);
  process.exit(runRelay(ssh!, config!, dir!, args));
}
