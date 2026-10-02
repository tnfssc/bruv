// T3_WEB_DIST=<upstream>/apps/web/dist node --test integrations/t3/upstream/chunks*.test.mjs
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const dist = process.env.T3_WEB_DIST;
if (!dist) throw new Error("Set T3_WEB_DIST to the upstream apps/web/dist directory");
const manifest = JSON.parse(readFileSync(join(dist, ".vite/manifest.json"), "utf8"));

test("upstream codec, grammar payloads and chat route stay outside startup", () => {
  function emitted(id) {
    const entry = manifest[id];
    assert.ok(entry?.file, "missing manifest entry: " + id);
    const info = statSync(join(dist, entry.file));
    assert.ok(info.isFile() && info.size > 0, "empty emitted file: " + entry.file);
    return entry.file;
  }
  const visited = new Set();
  const startup = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    visited.add(id);
    startup.add(emitted(id));
    for (const dependency of manifest[id].imports ?? []) visit(dependency);
  }
  visit("src/main.tsx");

  function lazy(matches, label, dynamic = false) {
    assert.ok(matches.length > 0, "missing payload: " + label);
    for (const id of matches) {
      if (dynamic) assert.equal(manifest[id]?.isDynamicEntry, true, id);
      assert.ok(!startup.has(emitted(id)), "startup payload: " + id);
    }
  }
  const ids = Object.keys(manifest);
  for (const suffix of ["/node_modules/heic-to/dist/csp/heic-to.js", "/node_modules/shiki/dist/wasm.mjs"]) {
    const matches = ids.filter((id) => id.endsWith(suffix));
    lazy(matches, suffix, true);
  }
  // C++ may be a shared chunk, not a direct dynamic language entry. Check emitted files.
  for (const language of ["cpp", "emacs-lisp"]) {
    const pattern = new RegExp("^assets/" + language + "-[^/]+\\.js$");
    const matches = ids.filter((id) => pattern.test(manifest[id].file));
    lazy(matches, language);
  }
  const chat = "src/routes/_chat.tsx?tsr-split=component";
  lazy([chat], chat, true);
});
