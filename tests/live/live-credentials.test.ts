import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLiveKey, parseLiveKey } from "../../src/live/credentials";

const fake = "not-a-real-key-12345";

async function expectUnavailableKey(path: string): Promise<void> {
  const error = await loadLiveKey(path).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toContain("0600");
  expect(String(error)).not.toContain(fake);
}

describe("Live credentials", () => {
  test("parses literal assignment without executing shell", () => {
    expect(parseLiveKey('# comment\nexport GEMINI_API_KEY="' + fake + '"\n')).toBe(fake);
    expect(parseLiveKey("GEMINI_API_KEY=dotted.private-key_12345")).toBe("dotted.private-key_12345");
  });

  test("rejects invalid assignments without exposing their contents", () => {
    for (const source of [
      "GEMINI_API_KEY=$(danger)",
      "GEMINI_API_KEY=secret bad",
      "",
      "GEMINI_API_KEY=" + fake + "\nGEMINI_API_KEY=" + fake,
    ]) {
      let error: unknown;
      try {
        parseLiveKey(source);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain(fake);
    }
  });

  test("requires private regular file and never leaks file contents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bruv-live-key-test-"));
    const path = join(dir, "live.env");
    try {
      await writeFile(path, "GEMINI_API_KEY=" + fake, { mode: 0o600 });
      expect(await loadLiveKey(path)).toBe(fake);
      await chmod(path, 0o644);
      await expectUnavailableKey(path);
      await chmod(path, 0o600);
      await symlink(path, join(dir, "link"));
      await expectUnavailableKey(join(dir, "link"));
      await writeFile(path, "GEMINI_API_KEY=" + fake + " invalid");
      await expectUnavailableKey(path);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("credential file reads reject oversized and non-regular sources with opaque errors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bruv-live-key-bounds-"));
    try {
      const path = join(dir, "large");
      await writeFile(path, "GEMINI_API_KEY=" + fake + "\n#" + "x".repeat(16_384), { mode: 0o600 });
      await expectUnavailableKey(path);
      await expectUnavailableKey(dir);
      await expectUnavailableKey(join(dir, "missing"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
