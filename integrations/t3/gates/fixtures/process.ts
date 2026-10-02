import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";

export type OwnedProcess = { pid: number; startTime: string };

export async function processIdentity(pid: number): Promise<OwnedProcess | undefined> {
  try {
    const statLine = await Bun.file(`/proc/${pid}/stat`).text();
    // comm may contain spaces and parentheses; fields after its final ") " start at field 3.
    const fields = statLine
      .slice(statLine.lastIndexOf(") ") + 2)
      .trim()
      .split(/\s+/);
    return { pid, startTime: fields[19] ?? "" };
  } catch {
    return undefined;
  }
}
export async function directChildren(pid: number): Promise<number[]> {
  try {
    const value = await Bun.file(`/proc/${pid}/task/${pid}/children`).text();
    return value.trim() ? value.trim().split(/\s+/).map(Number).filter(Number.isSafeInteger) : [];
  } catch {
    return [];
  }
}
export async function processTree(roots: number[]): Promise<OwnedProcess[]> {
  const pending = [...roots];
  const seen = new Set<number>();
  const result: OwnedProcess[] = [];
  while (pending.length) {
    const pid = pending.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const identity = await processIdentity(pid);
    if (!identity) continue;
    result.push(identity);
    pending.push(...(await directChildren(pid)));
  }
  return result;
}
/** Only pass children launched detached by the calling fixture. Identity alone is not kill authority. */
export async function stopDetachedGroup(child: ChildProcess | undefined, graceMs: number) {
  if (!child || child.exitCode !== null || !child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await Promise.race([once(child, "exit"), sleep(graceMs)]).catch(() => {});
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    await once(child, "exit").catch(() => {});
  }
}
