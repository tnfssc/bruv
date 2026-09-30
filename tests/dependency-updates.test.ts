import { describe, expect, test } from "bun:test";
import { markdownVersionSummary, selectDependencyNames, validatePiAlignment } from "../scripts/update-dependencies";

const manifest = {
  dependencies: {
    "@earendil-works/pi-ai": "0.99.1",
    "@earendil-works/pi-server": "0.99.1",
    exact: "1.2.3",
    major: "^1.0.0",
    "resolve.exports": "2.0.2",
  },
  devDependencies: {
    "@earendil-works/pi-tui": "0.99.1",
    "@types/bun": "1.4.2",
    typescript: "7.0.2",
    exact: "1.2.3",
  },
};

describe("root dependency updater", () => {
  test("selects all root names including exact, major and Pi pins, excluding the Bun toolchain", () => {
    expect(selectDependencyNames(manifest)).toEqual([
      "@earendil-works/pi-ai",
      "@earendil-works/pi-server",
      "@earendil-works/pi-tui",
      "exact",
      "major",
      "resolve.exports",
      "typescript",
    ]);
    expect(selectDependencyNames({})).toEqual([]);
  });

  test("validates Pi alignment across both root dependency sections", () => {
    expect(() => validatePiAlignment(manifest)).not.toThrow();
    expect(() => validatePiAlignment({})).not.toThrow();
    expect(() =>
      validatePiAlignment({
        ...manifest,
        devDependencies: { "@earendil-works/pi-tui": "0.100.0" },
      }),
    ).toThrow("not aligned");
    expect(() => validatePiAlignment({ dependencies: { "other/pi-ai": "1", "other/pi-server": "2" } })).not.toThrow();
  });

  test("summarizes changed versions, additions and removals in both sections", () => {
    const summary = markdownVersionSummary(
      { dependencies: { exact: "1.0.0", removed: "1" }, devDependencies: { typescript: "6" } },
      { dependencies: { exact: "2.0.0", added: "3" }, devDependencies: { typescript: "7" } },
    );
    expect(summary).toContain("| dependencies | exact | 1.0.0 | 2.0.0 |");
    expect(summary).toContain("| dependencies | added | — | 3 |");
    expect(summary).toContain("| dependencies | removed | 1 | — |");
    expect(summary).toContain("| devDependencies | typescript | 6 | 7 |");
    expect(summary).not.toContain("lockfile-only");
  });

  test("notes lockfile-only changes when declarations are unchanged", () => {
    expect(markdownVersionSummary(manifest, manifest)).toContain("lockfile-only");
    expect(markdownVersionSummary({}, {})).toContain("No root dependency version declarations changed");
  });

  test("fixture allows only resolve.exports in the exact private dispatch environment", () => {
    expect(
      selectDependencyNames(manifest, {
        fixture: true,
        env: {
          GITHUB_REPOSITORY: "tnfssc/die-dependency-pr-fixture-20260930",
          GITHUB_EVENT_NAME: "workflow_dispatch",
        },
      }),
    ).toEqual(["resolve.exports"]);
  });

  test("fixture denies missing, wrong repository and wrong event environments", () => {
    for (const env of [
      {},
      { GITHUB_REPOSITORY: "tnfssc/die", GITHUB_EVENT_NAME: "workflow_dispatch" },
      { GITHUB_REPOSITORY: "tnfssc/die-dependency-pr-fixture-20260930", GITHUB_EVENT_NAME: "push" },
    ]) {
      expect(() => selectDependencyNames(manifest, { fixture: true, env })).toThrow("--fixture is only allowed");
    }
  });

  test("CLI denies fixture before spawning an update", async () => {
    const child = Bun.spawn([process.execPath, "scripts/update-dependencies.ts", "--fixture"], {
      cwd: new URL("../", import.meta.url).pathname,
      env: { ...process.env, GITHUB_REPOSITORY: "tnfssc/die", GITHUB_EVENT_NAME: "workflow_dispatch" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await child.exited).toBe(1);
    expect(await new Response(child.stderr).text()).toContain("--fixture is only allowed");
  });
});
