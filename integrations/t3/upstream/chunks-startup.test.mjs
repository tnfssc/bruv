// Check the emitted graph, not source/dev imports or just asset sizes.
// T3_WEB_DIST=<built client> node --test integrations/t3/upstream/chunks-startup.test.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { init, parse } from "es-module-lexer";

const dist = process.env.T3_WEB_DIST;
if (!dist) throw new Error("Set T3_WEB_DIST to the built client directory");
const assets = resolve(dist, "assets");
await init;
const graph = new Map();
for (const name of readdirSync(assets).filter((name) => name.endsWith(".js"))) {
  const file = join(assets, name);
  const [imports] = parse(readFileSync(file, "utf8"));
  graph.set(
    file,
    imports
      .filter((entry) => entry.type === "static" && entry.specifier?.startsWith("."))
      .map((entry) => resolve(dirname(file), entry.specifier)),
  );
}

test("production chunks have no cyclic static initialization graph", () => {
  assert.ok(graph.size > 0, "expected built JavaScript chunks");
  const done = new Set();
  const active = [];
  function visit(file) {
    const cycle = active.indexOf(file);
    assert.equal(
      cycle,
      -1,
      "cyclic chunks: " + [...active.slice(cycle), file].map((path) => path.slice(assets.length + 1)).join(" -> "),
    );
    if (done.has(file)) return;
    assert.ok(graph.has(file), "missing static dependency: " + file);
    active.push(file);
    for (const dependency of graph.get(file)) visit(dependency);
    active.pop();
    done.add(file);
  }
  for (const file of graph.keys()) visit(file);
});
