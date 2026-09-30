import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => Bun.file(resolve(root, path)).text();

describe("daily dependency PRs", () => {
  test("native Bun updates are daily, root-only, grouped, and target develop", async () => {
    const config = Bun.YAML.parse(await read(".github/dependabot.yml")) as {
      version: number;
      updates: Record<string, unknown>[];
    };
    expect(config.version).toBe(2);
    expect(config.updates).toHaveLength(1);
    expect(config.updates[0]).toEqual({
      "package-ecosystem": "bun",
      directory: "/",
      "target-branch": "develop",
      schedule: { interval: "daily", time: "06:00", timezone: "Etc/UTC" },
      "open-pull-requests-limit": 1,
      groups: { "root-bun-dependencies": { patterns: ["*"] } },
      ignore: [{ "dependency-name": "@earendil-works/pi-*" }],
    });
    expect(await Bun.file(resolve(root, "bun.lock")).exists()).toBe(true);
    expect(await Bun.file(resolve(root, "bun.lockb")).exists()).toBe(false);
  });

  test("all checked Pi packages remain excluded from blind updates", async () => {
    const manifest = JSON.parse(await read("package.json"));
    const pi = Object.entries(manifest.dependencies).filter(([name]) => name.startsWith("@earendil-works/pi-"));
    expect(pi).toHaveLength(4);
    for (const [, version] of pi) expect(version).toBe("0.99.1");
    const prepare = await read("scripts/prepare-assets.ts");
    expect(prepare).toContain('piPackage.version !== "0.99.1"');
    expect(prepare).toContain('createHash("sha256")');
  });

  test("Dependabot PRs use existing read-only, secret-free CI", async () => {
    const ci = Bun.YAML.parse(await read(".github/workflows/ci.yml")) as {
      on: Record<string, unknown>;
      permissions: Record<string, string>;
      jobs: Record<string, { steps: { uses?: string; run?: string }[] }>;
    };
    expect(Object.hasOwn(ci.on, "pull_request")).toBe(true);
    expect(ci.permissions).toEqual({ contents: "read" });
    expect(ci.jobs.test.steps.some((step) => step.run === "bun run ci")).toBe(true);
    expect(ci.jobs["live-macos"].steps.some((step) => step.run === "bun run ci:macos")).toBe(true);
    const source = await read(".github/workflows/ci.yml");
    expect(source).not.toContain("secrets.");
    expect(source).not.toContain("dependabot[bot]");
    for (const job of Object.values(ci.jobs)) {
      for (const step of job.steps) {
        if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
      }
    }
  });
});
