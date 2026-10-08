import { expect, spyOn, test } from "bun:test";
import { probeOpenAITransport } from "../../src/live/offline-transport-probe";
import { OPENAI_REALTIME_MODELS } from "../../src/live/providers";

test("default transport probes both model outcomes and releases every loopback listener", async () => {
  const originalServe = Bun.serve;
  const servers: ReturnType<typeof Bun.serve>[] = [];
  const serve = spyOn(Bun, "serve").mockImplementation((options) => {
    const server = originalServe(options);
    servers.push(server);
    return server;
  });
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    await probeOpenAITransport();
    expect(serve).toHaveBeenCalledTimes(OPENAI_REALTIME_MODELS.length * 2);
    for (const [options] of serve.mock.calls) {
      expect(options.hostname).toBe("127.0.0.1");
      expect(options.port).toBe(0);
    }
    for (const server of servers) {
      expect(server.pendingWebSockets).toBe(0);
      await expect(fetch(server.url)).rejects.toThrow();
    }
    expect(log).toHaveBeenCalledWith(
      "Offline OpenAI default transport: full/mini session.updated and HTTP 401 passed (loopback only)",
    );
  } finally {
    for (const server of servers) server.stop(true);
    serve.mockRestore();
    log.mockRestore();
  }
});

test("a different HTTP rejection is not 401 evidence and still releases loopback resources", async () => {
  const originalServe = Bun.serve;
  const servers: ReturnType<typeof Bun.serve>[] = [];
  const serve = spyOn(Bun, "serve").mockImplementation((options) => {
    // Keep the first successful handshake real; corrupt only the rejection fixture.
    const server = originalServe(
      servers.length === 1 ? { ...options, fetch: () => new Response("not authorized", { status: 403 }) } : options,
    );
    servers.push(server);
    return server;
  });
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    await expect(probeOpenAITransport()).rejects.toThrow("Unsafe or missing 401 classification");
    expect(serve).toHaveBeenCalledTimes(2);
    expect(log).not.toHaveBeenCalled();
    for (const server of servers) {
      expect(server.pendingWebSockets).toBe(0);
      await expect(fetch(server.url)).rejects.toThrow();
    }
  } finally {
    for (const server of servers) server.stop(true);
    serve.mockRestore();
    log.mockRestore();
  }
});
