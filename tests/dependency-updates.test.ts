import { describe, expect, test } from "bun:test";
import {
  markdownLockSummary,
  markdownVersionSummary,
  selectDependencyNames,
  validateDependencyUpdate,
  validatePiAlignment,
} from "../scripts/update-dependencies";

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

  test("rejects toolchain changes and misaligned Pi versions while accepting ordinary updates", () => {
    expect(() => validateDependencyUpdate(manifest, manifest)).not.toThrow();
    expect(() =>
      validateDependencyUpdate(manifest, {
        ...manifest,
        dependencies: { ...manifest.dependencies, exact: "2.0.0" },
      }),
    ).not.toThrow();
    for (const section of ["dependencies", "devDependencies"] as const) {
      expect(() =>
        validateDependencyUpdate({ [section]: { "@types/bun": "1.4.2" } }, { [section]: { "@types/bun": "1.5.0" } }),
      ).toThrow("protected @types/bun");
      expect(() => validateDependencyUpdate({ [section]: { "@types/bun": "1.4.2" } }, {})).toThrow(
        "protected @types/bun",
      );
      expect(() => validateDependencyUpdate({}, { [section]: { "@types/bun": "1.4.2" } })).toThrow(
        "protected @types/bun",
      );
    }
    expect(() =>
      validateDependencyUpdate(manifest, {
        ...manifest,
        devDependencies: { ...manifest.devDependencies, "@earendil-works/pi-tui": "0.100.0" },
      }),
    ).toThrow("not aligned");
  });

  test("orders changed root versions by section then package, including missing sections", () => {
    expect(
      markdownVersionSummary(
        { dependencies: { z: "1", unchanged: "1", a: "1" } },
        { dependencies: { a: "2", unchanged: "1" }, devDependencies: { z: "3", a: "2" } },
      ),
    ).toBe(
      [
        "# Dependency version updates",
        "",
        "| Section | Package | Before | After |",
        "| --- | --- | --- | --- |",
        "| dependencies | a | 1 | 2 |",
        "| dependencies | z | 1 | — |",
        "| devDependencies | a | — | 2 |",
        "| devDependencies | z | — | 3 |",
        "",
      ].join("\n"),
    );
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
      { GITHUB_REPOSITORY: "tnfssc/bruv", GITHUB_EVENT_NAME: "workflow_dispatch" },
      { GITHUB_REPOSITORY: "tnfssc/die-dependency-pr-fixture-20260930", GITHUB_EVENT_NAME: "push" },
    ]) {
      expect(() => selectDependencyNames(manifest, { fixture: true, env })).toThrow("--fixture is only allowed");
    }
  });

  test("CLI denies fixture before spawning an update", async () => {
    const child = Bun.spawn([process.execPath, "scripts/update-dependencies.ts", "--fixture"], {
      cwd: new URL("../", import.meta.url).pathname,
      env: { ...process.env, GITHUB_REPOSITORY: "tnfssc/bruv", GITHUB_EVENT_NAME: "workflow_dispatch" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await child.exited).toBe(1);
    expect(await new Response(child.stderr).text()).toContain("--fixture is only allowed");
  });
});

test("lockfile summary names transitive updates and additions/removals without metadata noise", () => {
  const before =
    '{"packages":{"@types/node":["@types/node@26.6.1","old hash"],"gone":["gone@1"],"same":["same@1","old metadata"],},}';
  const after = JSON.stringify({
    packages: {
      "@types/node": ["@types/node@26.6.3", "new hash"],
      added: ["added@2"],
      same: ["same@1", "new metadata"],
    },
  });
  const summary = markdownLockSummary(before, after);
  expect(summary).toContain("| @types/node | @types/node@26.6.1 | @types/node@26.6.3 |");
  expect(summary).toContain("| gone | gone@1 | — |");
  expect(summary).toContain("| added | — | added@2 |");
  expect(summary).not.toContain("| same |");
  expect(markdownLockSummary(after, after)).toContain("No resolved package versions changed");
});

test("lockfile summary bounds changed rows after sorting, not before filtering metadata", () => {
  const packages = Object.fromEntries(
    Array.from({ length: 201 }, (_, index) => {
      const name = "package-" + String(200 - index).padStart(3, "0");
      return [name, [name + "@2"]];
    }),
  );
  const summary = markdownLockSummary(
    JSON.stringify({ packages: { "aaa-same": ["same@1", "old metadata"] } }),
    JSON.stringify({ packages: { ...packages, "aaa-same": ["same@1", "new metadata"] } }),
  );
  const rows = summary.split("\n").filter((line) => line.startsWith("| package-"));
  expect(rows).toHaveLength(200);
  expect(rows[0]).toBe("| package-000 | — | package-000@2 |");
  expect(rows.at(-1)).toBe("| package-199 | — | package-199@2 |");
  expect(summary).not.toContain("| aaa-same |");
  expect(summary).not.toContain("| package-200 |");
  expect(summary).toContain("Further package changes omitted; see the full lockfile diff.");
});

test("lockfile constructor additions use a missing previous version", () => {
  const summary = markdownLockSummary('{"packages":{}}', '{"packages":{"constructor":["constructor@1.0.0"]}}');
  expect(summary).toContain("| constructor | — | constructor@1.0.0 |");
  expect(summary).not.toContain("function Object");
});

test("lockfile constructor removals use a missing next version", () => {
  const summary = markdownLockSummary('{"packages":{"constructor":["constructor@1.0.0"]}}', '{"packages":{}}');
  expect(summary).toContain("| constructor | constructor@1.0.0 | — |");
  expect(summary).not.toContain("function Object");
});

test("root constructor additions and removals ignore inherited properties too", () => {
  const empty = { dependencies: {} };
  const added = { dependencies: { constructor: "1.0.0" } };
  expect(markdownVersionSummary(empty, added)).toContain("| dependencies | constructor | — | 1.0.0 |");
  expect(markdownVersionSummary(added, empty)).toContain("| dependencies | constructor | 1.0.0 | — |");
});
