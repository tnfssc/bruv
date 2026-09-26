import { createServer, connect } from "node:net";
const target = Number(process.argv[2]);
const server = createServer((down) => {
  const up = connect(target, "127.0.0.1");
  let sent = 0, received = 0, downstream = 0;
  down.on("data", (b) => { sent += b.length; up.write(b); });
  up.on("data", (b) => {
    received += b.length;
    // Never forward upstream response bytes. The server returned from its fsynced acceptance path.
    console.log(JSON.stringify({ gate: "blocked-response", requestBytes: sent, upstreamResponseBytes: received, downstreamResponseBytes: downstream }));
    down.destroy(); up.destroy(); server.close();
  });
  down.on("error", () => up.destroy());
  up.on("error", () => down.destroy());
});
server.listen(0, "127.0.0.1", () => console.log(JSON.stringify({ gatePort: (server.address() as { port: number }).port })));
setTimeout(() => { server.close(); process.exitCode = 1; }, 12000).unref();

export {};
