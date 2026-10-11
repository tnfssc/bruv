import { chromium } from "playwright-core";
// Standard Playwright cache by default; explicit executable for an existing install.
export const launchBrowser = () =>
  chromium.launch({
    executablePath: process.env.CHROMIUM_BIN || undefined,
  });
