import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";

// Only resources acquired by this probe belong here. Evidence lives outside root.
export async function withBrowserProbe(name, run) {
  const scratch = resolve(import.meta.dir, "../../.tmp");
  await mkdir(scratch, { recursive: true });
  const owned = { root: await mkdtemp(join(scratch, name + "-")), servers: [] };
  owned.stop = async () => {
    const browser = owned.browser;
    const proc = owned.proc;
    owned.browser = undefined;
    owned.proc = undefined;
    try {
      await browser?.close();
    } finally {
      try {
        if (proc) {
          proc.kill("SIGTERM");
          await proc.exited;
        }
      } finally {
        for (const server of owned.servers.splice(0)) await server.stop(true);
      }
    }
  };
  try {
    return await run(owned);
  } finally {
    try {
      await owned.stop();
    } finally {
      await rm(owned.root, { recursive: true, force: true });
    }
  }
}

// session_start emits an OSC receipt. A PTY frame is not a marker boundary.
export function hasFixtureMarker(messages) {
  return messages
    .filter((m) => m.type === "output")
    .map((m) => atob(m.data))
    .join("")
    .includes("BROWSER_FIXTURE_READY");
}

export async function waitForFixture(page, sockets, messages) {
  await page.waitForFunction(
    ({ sockets, messages }) => {
      const id = document.querySelector('[role="tab"][aria-selected="true"]')?.id.slice(4);
      const socket = window[sockets].get(id);
      return (
        socket?.readyState === WebSocket.OPEN &&
        socket.probeReady &&
        document.querySelector("#terminal-status")?.hidden &&
        (window[messages].get(id) || [])
          .filter((m) => m.type === "output")
          .map((m) => atob(m.data))
          .join("")
          .includes("BROWSER_FIXTURE_READY")
      );
    },
    { sockets, messages },
  );
}
