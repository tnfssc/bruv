import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";

// A deadline does not stop work. Cleanup below also kills and waits for exit.
export async function within(promise, ms, why) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(why)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function closeProbeBrowser(browser) {
  if (!browser) return;
  try {
    await within(browser.close(), 1500, "Browser close timed out");
  } catch {
    // Playwright's local-browser test hook kills its owned process and reaps it.
    if (browser.isConnected()) await within(browser._channel.killForTests({}), 5000, "Browser force-stop timed out");
  }
  if (browser.isConnected()) throw Error("Browser survived cleanup");
}

async function stopProbeProcess(proc) {
  if (!proc) return;
  proc.kill("SIGTERM");
  try {
    // The web server gives its PTY children 1500 ms before SIGKILL.
    await within(proc.exited, 3000, "Process close timed out");
  } catch {
    proc.kill("SIGKILL");
    await within(proc.exited, 1500, "Process force-stop timed out");
  }
}

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
      await closeProbeBrowser(browser);
    } finally {
      try {
        await stopProbeProcess(proc);
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
