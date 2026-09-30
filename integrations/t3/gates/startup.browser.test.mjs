// Manual regression against an isolated packaged server. No model/API calls.
// T3_STARTUP_ACCEPT=1 T3_STARTUP_URL=http://127.0.0.1:<port> \
// PLAYWRIGHT_MODULE=<absolute index.mjs> node --test integrations/t3/gates/startup.browser.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

test("packaged production client mounts its workspace on cold load and reload", { timeout: 60000 }, async () => {
  assert.equal(process.env.T3_STARTUP_ACCEPT, "1", "explicit isolated-server opt-in required");
  const url = new URL(process.env.T3_STARTUP_URL);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "loopback fixture required");
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
    // Chromium's local-network policy otherwise blocks this explicit loopback fixture's WS.
    args: ["--no-sandbox", "--disable-features=LocalNetworkAccessChecks"],
  });
  try {
    for (let cold = 0; cold < 2; cold++) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        await page.goto(url.href);
        for (let load = 0; load < 2; load++) {
          await page.waitForFunction(() => {
            const text = document.body.innerText;
            return text.includes("T3 Code could not load.") || text.includes("What should we build in");
          });
          assert.deepEqual(errors, []);
          await page.getByText("What should we build in", { exact: false }).waitFor();
          assert.ok(!(await page.locator("body").innerText()).includes("T3 Code could not load."));
          assert.deepEqual(errors, []);
          if (load === 0) await page.reload();
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
});
