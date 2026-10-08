import { mock } from "bun:test";
import { strict as assert } from "node:assert";
import { existsSync, type PathLike, type RmOptions, readdirSync } from "node:fs";
import * as fs from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { DiskEntryStore } from "../../src/history/disk-entry-store";

// Hold the store alive so GC cannot substitute for the manager's finalizer.
let pending: { store: DiskEntryStore; dir: string; spool: string; disposed: boolean } | undefined;
const originalPending = DiskEntryStore.pending;
DiskEntryStore.pending = (...args) => {
  const store = originalPending(...args);
  assert.equal(pending, undefined, "Failure scenario must own exactly one pending store");
  const dir = dirname(store.targetPath);
  const spools = readdirSync(dir).filter((name) => name.startsWith(basename(store.targetPath) + ".pending-"));
  assert.equal(spools.length, 1, "Failure scenario must create a real pending spool");
  pending = { store, dir, spool: join(dir, spools[0]!), disposed: false };
  return store;
};
const originalDispose = DiskEntryStore.prototype.dispose;
DiskEntryStore.prototype.dispose = function (this: DiskEntryStore) {
  const result = originalDispose.call(this);
  if (this === pending?.store) pending.disposed = true;
  return result;
};

let injected = false;
const originalAppend = DiskEntryStore.prototype.append;
DiskEntryStore.prototype.append = function (entry) {
  if (entry.type === "message" && !injected) {
    assert.ok(pending && existsSync(pending.spool), "First append must fail while the store is pending");
    injected = true;
    throw new Error("injected soak append failure");
  }
  return originalAppend.call(this, entry);
};

// Snapshot before rm, but always let rm run: both outcomes must clean their directory.
let beforeDirectoryRemoval: { disposed: boolean; spoolExists: boolean } | undefined;
const originalRm = fs.rm;
mock.module("node:fs/promises", () => ({
  ...fs,
  rm: async (path: PathLike, options?: RmOptions) => {
    if (pending && path === pending.dir) {
      beforeDirectoryRemoval = {
        disposed: pending.disposed,
        spoolExists: existsSync(pending.spool),
      };
    }
    return originalRm(path, options);
  },
}));

// Negative control removes only manager disposal, not the script's error or directory finalizer.
if (process.env.BRUV_TEST_SKIP_MANAGER_DISPOSAL === "1") {
  const managerPath = new URL("../../src/history/session-manager.ts", import.meta.url).pathname;
  const manager = await import(managerPath);
  mock.module(managerPath, () => ({ ...manager, disposeDiskBackedSessionManager: () => {} }));
}

process.on("exit", () => {
  assert.ok(pending, "Probe must create a pending store");
  assert.ok(injected, "Probe must reach the injected append failure");
  assert.ok(beforeDirectoryRemoval, "Probe must attempt directory cleanup");
  assert.equal(existsSync(pending.dir), false, "Probe temp directory remains");
  assert.equal(beforeDirectoryRemoval.disposed, true, "Probe must dispose its pending store before directory removal");
  assert.equal(beforeDirectoryRemoval.spoolExists, false, "Probe pending spool remains before directory removal");
  console.log("PROBE_CLEANUP_OK");
});
