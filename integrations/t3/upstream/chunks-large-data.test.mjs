// T3_WEB_DIST=<upstream>/apps/web/dist node --test integrations/t3/upstream/chunks-large-data.test.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const dist = process.env.T3_WEB_DIST;
if (!dist) throw new Error("Set T3_WEB_DIST to the built upstream apps/web/dist directory");
const assets = join(dist, "assets");
const entries = readdirSync(assets);
const asset = (pattern) => {
  const files = entries.filter((name) => pattern.test(name));
  assert.equal(files.length, 1, String(pattern) + ": " + files.join(", "));
  return join(assets, files[0]);
};

test("worker and WASM payload are separately emitted and lazy", () => {
  const worker = asset(/^worker-[\w-]+\.js$/);
  assert.ok(statSync(worker).size < 500_000, "worker should not embed WASM");
  const wasm = asset(/^onig-[\w-]+\.wasm$/);
  assert.ok(statSync(wasm).size > 400_000, "real Oniguruma binary");
  assert.ok(readFileSync(worker, "utf8").includes("wasm-"), "worker imports the lazy WASM loader");
  assert.ok(entries.some((name) => /^wasm-[\w-]+\.js$/.test(name) && readFileSync(join(assets, name), "utf8").includes("onig-")), "WASM loader fetches the binary asset");
  assert.ok(!entries.some((name) => /^wasm-[\w-]+\.js$/.test(name) && statSync(join(assets, name)).size > 500_000));
});

test("large Shiki grammar data ships as JSON with tiny lazy loaders", () => {
  for (const language of ["cpp", "emacs-lisp"]) {
    const data = JSON.parse(readFileSync(asset(new RegExp("^" + language + "-[\\w-]+\\.json$")), "utf8"));
    assert.equal(data.name, language);
    const js = entries.filter((name) => name.startsWith(language + "-") && name.endsWith(".js"));
    assert.ok(js.length > 0, language + " lazy module is still present");
    assert.ok(js.every((name) => statSync(join(assets, name)).size < 500_000), language);
  }
});
