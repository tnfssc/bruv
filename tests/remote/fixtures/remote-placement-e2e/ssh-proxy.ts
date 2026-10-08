/** Real SSH byte transport into a network:none container. No emulated SSH/RPC. */
import { connect } from "node:net";
const socket = connect({ host: "127.0.0.1", port: 2222 });
socket.on("error", (error) => {
  console.error(String(error));
  process.exit(1);
});
process.stdin.pipe(socket);
socket.pipe(process.stdout);
socket.on("close", () => process.exit(0));
