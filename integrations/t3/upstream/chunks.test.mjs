// Run after the pinned upstream web production build:
// T3_WEB_DIST=<upstream>/apps/web/dist node --test integrations/t3/upstream/chunks.test.mjs

import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const dist = process.env.T3_WEB_DIST;
if (!dist) {
  throw new Error("Set T3_WEB_DIST to the upstream apps/web/dist directory");
}
const manifest = JSON.parse(readFileSync(join(dist, ".vite/manifest.json"), "utf8"));
const main = manifest["src/main.tsx"];
const chat = manifest["src/routes/_chat.tsx?tsr-split=component"];
const bytes = (entry) => statSync(join(dist, entry.file)).size;

test("alternate sidebar stays outside the startup graph", () => {
  assert.ok(main);
  for (const id of ["src/components/Sidebar.tsx", "src/components/LegacySidebar.tsx"]) {
    assert.equal(manifest[id]?.isDynamicEntry, true, id);
    assert.ok(main.dynamicImports?.includes(id), id);
    assert.ok(!main.imports?.includes(id), id);
    assert.notEqual(main.file, manifest[id].file);
  }
  // Regression bound against the measured pinned baseline (801,444 bytes).
  assert.ok(bytes(main) < 801444, `main: ${bytes(main)} bytes`);
});

test("composer and timeline retain separate lazy chat boundaries", () => {
  assert.ok(chat);
  for (const id of ["src/components/chat/ChatComposer.tsx", "src/components/chat/MessagesTimeline.tsx"]) {
    assert.equal(manifest[id]?.isDynamicEntry, true, id);
    assert.ok(chat.dynamicImports?.includes(id), id);
    assert.ok(!chat.imports?.includes(id), id);
    assert.notEqual(chat.file, manifest[id].file);
  }
  // Regression bound against the measured pinned baseline (888,994 bytes).
  assert.ok(bytes(chat) < 888994, `chat: ${bytes(chat)} bytes`);
});
