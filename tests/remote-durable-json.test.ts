import { expect, test, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { durableJsonReplace } from "../src/remote/durable-json";

test("JSON replacement syncs private file before rename, then the parent directory", () => {
  const dir = fs.mkdtempSync(join(tmpdir(), "remote-json-"));
  const path = join(dir, "record.json");
  const order: string[] = [];
  const sync = fs.fsyncSync,
    rename = fs.renameSync;
  const syncSpy = spyOn(fs, "fsyncSync").mockImplementation((fd) => {
    order.push(fs.fstatSync(fd).isDirectory() ? "sync directory" : "sync file");
    sync(fd);
  });
  const renameSpy = spyOn(fs, "renameSync").mockImplementation((source, target) => {
    expect(fs.statSync(source).mode & 0o777).toBe(0o600);
    order.push("rename");
    rename(source, target);
  });
  try {
    durableJsonReplace(path, { state: "accepted" });
    expect(order).toEqual(["sync file", "rename", "sync directory"]);
    durableJsonReplace(path, { state: "done" });
    expect(JSON.parse(fs.readFileSync(path, "utf8"))).toEqual({ state: "done" });
    expect(fs.statSync(path).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(dir)).toEqual(["record.json"]);
  } finally {
    syncSpy.mockRestore();
    renameSpy.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("failed write preserves the previously committed JSON and propagates the error", () => {
  const dir = fs.mkdtempSync(join(tmpdir(), "remote-json-failure-"));
  const path = join(dir, "record.json");
  durableJsonReplace(path, { identity: "pinned" });
  const writeSpy = spyOn(fs, "writeFileSync").mockImplementation(() => {
    throw Error("disk full");
  });
  try {
    expect(() => durableJsonReplace(path, { identity: "replacement" })).toThrow("disk full");
    expect(JSON.parse(fs.readFileSync(path, "utf8"))).toEqual({ identity: "pinned" });
  } finally {
    writeSpy.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
