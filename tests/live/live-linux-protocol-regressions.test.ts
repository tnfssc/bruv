import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// select() on subprocess pipes is Unix-only; Pulse calls are mocked in this suite.
test.skipIf(process.platform === "win32")(
  "device-free Linux protocol harness regressions",
  () => {
    const script = fileURLToPath(new URL("../../native/live-linux/tests/test_protocol.py", import.meta.url));
    const result = spawnSync("python3", ["-B", script, "-v"], {
      encoding: "utf8",
      timeout: 15_000,
      killSignal: "SIGKILL",
    });
    if (result.error || result.status !== 0) {
      throw new Error(
        `Python protocol regressions failed (exit ${result.status}, signal ${result.signal}):\n` +
          `${result.error?.message ?? ""}\n${result.stdout ?? ""}${result.stderr ?? ""}`,
      );
    }
    expect(result.status).toBe(0);
  },
  20_000,
);
