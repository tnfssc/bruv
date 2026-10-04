import type { SpawnSyncReturns } from "node:child_process";

/** Keep signal/spawn failures visible even when neither stream has any output. */
export function describeUpdateProbe(executable: string, args: string[], result: SpawnSyncReturns<string>): string {
  const error = result.error as NodeJS.ErrnoException | undefined;
  return JSON.stringify({
    executable,
    args,
    status: result.status ?? null,
    signal: result.signal ?? null,
    error: error
      ? { name: error.name, message: error.message, code: error.code, errno: error.errno, syscall: error.syscall }
      : null,
    stdout: result.stdout ?? null,
    stderr: result.stderr ?? null,
  });
}
