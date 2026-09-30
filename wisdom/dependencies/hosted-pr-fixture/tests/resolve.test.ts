import { expect, test } from "bun:test";
import { exports as resolveExports } from "resolve.exports";
import installed from "../node_modules/resolve.exports/package.json";
import manifest from "../package.json";

test("installed dependency matches the exact manifest pin", () => {
  expect(installed.version).toBe(manifest.dependencies["resolve.exports"]);
});

test("conditional exports resolve import and require independently", () => {
  const pkg = { name: "example", exports: { ".": { import: "./esm.js", require: "./cjs.js" } } };
  expect(resolveExports(pkg, ".")).toEqual(["./esm.js"]);
  expect(resolveExports(pkg, ".", { require: true })).toEqual(["./cjs.js"]);
});
