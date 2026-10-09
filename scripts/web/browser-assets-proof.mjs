import assert from "node:assert/strict";
import { mkdir, mkdtemp, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
// This proves embedded assets, not the full CLI/renderer acceptance path.
const project = resolve(import.meta.dir, "../..");
const scratch = resolve(project, ".tmp/ghostty-assets");
await mkdir(scratch, { recursive: true });
const root = await mkdtemp(resolve(scratch, "run-"));
const binaryPath = resolve(root, "bruv");
await copyFile(resolve(project, "dist/bruv"), binaryPath);
const dir = resolve(root, "runtime");
await mkdir(dir, { recursive: true });
const proof = resolve(project, "artifacts/ghostty");
await mkdir(proof, { recursive: true });
const proc = Bun.spawn([binaryPath, "web", "--port", "0"], {
  cwd: dir,
  env: {
    HOME: dir,
    TMPDIR: dir,
    PATH: "/nonexistent",
    LANG: "C.UTF-8",
    SHELL: "/bin/sh",
    BRUV_CODING_AGENT_DIR: dir + "/agent",
    PI_CODING_AGENT_DIR: dir + "/agent",
  },
  stdout: "pipe",
  stderr: "pipe",
});
let output = "",
  errors = "";
void (async () => {
  for await (const bytes of proc.stdout) output += new TextDecoder().decode(bytes);
})();
void (async () => {
  for await (const bytes of proc.stderr) errors += new TextDecoder().decode(bytes);
})();
try {
  for (let i = 0; i < 200 && !output.includes("#token="); i++) await Bun.sleep(25);
  const url = output
    .split(/\s+/)
    .find((part) => part.startsWith("http://"))
    ?.split("#")[0];
  assert.ok(url, output + errors);
  const origin = new URL(url).origin;
  const response = await fetch(origin + "/ghostty-vt.wasm");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/wasm");
  assert.ok(response.headers.get("content-security-policy").includes("script-src 'self' 'wasm-unsafe-eval';"));
  const wasm = Buffer.from(await response.arrayBuffer());
  assert.equal(wasm.length, 423045);
  assert.equal(
    createHash("sha256").update(wasm).digest("hex"),
    "d6f0326f1874ad2ce9f289e3a4a0c5f3507d4cb38d8747e4b287def470a0c60a",
  );
  await WebAssembly.compileStreaming(fetch(origin + "/ghostty-vt.wasm"));
  assert.equal((await fetch(origin + "/ghostty-vt.wasm", { method: "HEAD" })).status, 405);
  assert.equal((await fetch(origin + "/ghostty-vt.wasm", { headers: { Host: "evil.example" } })).status, 403);
  const js = await (await fetch(origin + "/terminal.js")).text();
  assert.ok(js.includes("/ghostty-vt.wasm"));
  assert.ok(!js.includes(wasm.toString("base64")));
  const binary = Buffer.from(await Bun.file(binaryPath).arrayBuffer());
  let wasmCopies = 0,
    offset = 0;
  while (true) {
    offset = binary.indexOf(wasm, offset);
    if (offset < 0) break;
    wasmCopies++;
    offset += wasm.length;
  }
  assert.equal(wasmCopies, 1);
  assert.equal(binary.indexOf(wasm.toString("base64")), -1);
  const result = {
    binaryBytes: binary.length,
    binarySHA256: createHash("sha256").update(binary).digest("hex"),
    wasmBytes: wasm.length,
    wasmCopies,
    base64WasmCopies: 0,
    browserJSBytes: Buffer.byteLength(js),
    get: 200,
    head: 405,
    badHost: 403,
    compiledStreaming: true,
    sourceFreeRuntime: dir,
  };
  await Bun.write(resolve(proof, "packaging.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} finally {
  proc.kill("SIGTERM");
  await proc.exited;
}
