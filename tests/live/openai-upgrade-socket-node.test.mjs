import assert from "node:assert/strict";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { upgradeSocket } from "../../src/live/openai-upgrade-socket.ts";

// Run with: node --test tests/live/openai-upgrade-socket-node.test.mjs (Node 24).
// Bun 1.4.2 ends a rejected-upgrade response at its first partial body chunk,
// even with Content-Length outstanding, so it cannot exercise this lifetime.
test("closing during rejected-upgrade inspection cancels diagnostics and releases the peer", {
  skip: Boolean(process.versions.bun),
}, async () => {
  const peers = new Set();
  let requests = 0;
  let wroteResponse;
  const responseStarted = new Promise((resolve) => {
    wroteResponse = resolve;
  });
  const server = createServer((peer) => {
    peers.add(peer);
    peer.on("close", () => peers.delete(peer));
    peer.once("data", () => {
      requests++;
      peer.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 1000\r\n\r\npartial-private-body", wroteResponse);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const socket = upgradeSocket(`ws://127.0.0.1:${server.address().port}/?model=gpt-realtime-2.1`, {});
  const errors = [];
  socket.addEventListener("error", (event) => errors.push(event));
  try {
    await responseStarted;
    await sleep(40);
    // Verify this really reached the inspection window, unlike Bun's partial response.
    assert.equal(socket.readyState, 0);
    assert.equal(peers.size, 1);
    assert.deepEqual(errors, []);
    socket.close();
    for (let i = 0; i < 50 && peers.size; i++) await sleep(10);
    assert.equal(peers.size, 0);
    await sleep(1100); // neither transport error nor diagnostic timeout may deliver after cancellation
    assert.deepEqual(errors, []);
    assert.equal(requests, 1);
  } finally {
    socket.close();
    for (const peer of peers) peer.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});
