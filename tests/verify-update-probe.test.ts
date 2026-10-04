import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { describeUpdateProbe } from "../scripts/verify-update-probe";

function probe(executable: string, args: string[]) {
  return JSON.parse(describeUpdateProbe(executable, args, spawnSync(executable, args, { encoding: "utf8" })));
}

test("update probe diagnostics distinguish an empty-stream SIGKILL from an exit", () => {
  const killed = probe("/bin/sh", ["-c", "kill -KILL $$"]);
  expect(killed).toEqual({
    executable: "/bin/sh",
    args: ["-c", "kill -KILL $$"],
    status: null,
    signal: "SIGKILL",
    error: null,
    stdout: "",
    stderr: "",
  });
  const exited = probe("/bin/sh", ["-c", "printf partial; printf reason >&2; exit 7"]);
  expect(exited.status).toBe(7);
  expect(exited.signal).toBeNull();
  expect(exited.error).toBeNull();
  expect(exited.stdout).toBe("partial");
  expect(exited.stderr).toBe("reason");
});

test("update probe diagnostics retain invocation errors with null streams", () => {
  const missing = probe("/nonexistent/bruv-update-probe", ["--fail-normal-rename"]);
  expect(missing.status).toBeNull();
  expect(missing.signal).toBeNull();
  expect(missing.error.code).toBe("ENOENT");
  expect(missing.error.message).toContain("/nonexistent/bruv-update-probe");
  expect(missing.stdout).toBeNull();
  expect(missing.stderr).toBeNull();
});
