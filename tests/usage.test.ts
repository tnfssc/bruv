import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type PlanUsage, registerUsage, usageLines } from "../src/usage";
import { sdk } from "./sdk";

test.each(["stream", "headers"])(
  "usage reads %s events, warns once, and saves the latest limits",
  async (transport) => {
    mkdirSync(".tmp", { recursive: true });
    const dir = mkdtempSync(resolve(".tmp/usage-"));
    const notices: { text: string; type?: string }[] = [];
    const footer = new Map<string, string | undefined>();
    let snapshot: (ctx: ExtensionContext) => PlanUsage | undefined = () => undefined;
    const make = () =>
      sdk(
        [
          (pi) => {
            snapshot = registerUsage(pi, dir);
          },
        ],
        {
          notify: (text, type) => {
            notices.push({ text, type });
          },
          setStatus: (key, value) => {
            footer.set(key, value);
          },
        },
      );
    const app = await make();
    const runner = app.session.extensionRunner;
    const data: PlanUsage = {
      plan_type: "pro",
      rate_limits: {
        limit_reached: false,
        primary: { used_percent: 23, window_minutes: 300, reset_at: 1792059131 },
        secondary: { used_percent: 41, window_minutes: 10080, reset_at: 1792059131 },
      },
      credits: { has_credits: true, unlimited: false, balance: "50492.4594510000" },
    };
    const emit = async () => {
      if (transport === "stream")
        await runner.emit({
          type: "provider_stream_event",
          provider: "openai-codex",
          api: "openai-codex-responses",
          model: "gpt-6-astra",
          data: { type: "codex.rate_limits", ...data },
        });
      else {
        const headers: Record<string, string> = { "x-codex-plan-type": data.plan_type };
        for (const key of ["primary", "secondary"] as const) {
          const w = data.rate_limits[key];
          headers[`x-codex-${key}-used-percent`] = `${w?.used_percent ?? 0}`;
          headers[`x-codex-${key}-window-minutes`] = `${w?.window_minutes ?? 0}`;
          headers[`x-codex-${key}-reset-at`] = `${w?.reset_at ?? ""}`;
        }
        for (const [key, value] of Object.entries(data.credits))
          headers[`x-codex-credits-${key.replaceAll("_", "-")}`] = `${value}`;
        await runner.emit({ type: "after_provider_response", status: 200, headers });
      }
    };
    try {
      await app.session.prompt("/usage");
      expect(notices.at(-1)?.text.split("\n")).toHaveLength(2);
      expect(footer.get("bruv-usage")).toBeUndefined();
      const message = fauxAssistantMessage("answer");
      message.usage.totalTokens = 123;
      message.usage.cost.total = 0.42;
      app.session.sessionManager.appendMessage(message);
      await app.session.setModel({ ...app.faux.getModel(), id: "codex-fixture", api: "openai-codex-responses" });
      await app.session.prompt("/usage");
      expect(notices.at(-1)?.text.split("\n")).toHaveLength(2);
      expect(notices.at(-1)?.text).toContain("123 tokens · $0.42");
      await emit();
      expect(snapshot(runner.createContext())).toMatchObject(data);
      expect(footer.get("bruv-usage")).toBe("5h 23% · week 41%");
      await app.session.prompt("/usage");
      expect(notices.at(-1)?.text.match(/\[[#-]{10}\]/g)).toHaveLength(2);
      expect(notices.at(-1)?.text).toContain("pro");
      expect(notices.at(-1)?.text).toContain(Math.round(Number(data.credits.balance)).toLocaleString());
      data.rate_limits.primary = { used_percent: 91, window_minutes: 10080, reset_at: 1792059131 };
      data.rate_limits.secondary = null;
      await emit();
      await emit();
      expect(notices.filter((n) => n.type === "warning")).toHaveLength(1);
      expect(footer.get("bruv-usage")).toBe("week 91%");
      data.rate_limits.primary.used_percent = 100;
      data.rate_limits.limit_reached = true;
      await emit();
      await emit();
      expect(notices.filter((n) => n.type === "warning")).toHaveLength(2);
      expect(footer.get("bruv-usage")).toBe("week limit reached · using credits");
      await app.session.prompt("/usage");
      expect(notices.at(-1)?.text.match(/\[[#-]{10}\]/g)).toHaveLength(1);
      expect(notices.at(-1)?.text).toContain("yes · Using credits: yes");
      expect(JSON.parse(readFileSync(join(dir, "bruv-usage.json"), "utf8"))).toMatchObject(data);
      const lines = usageLines(data, 1792059131000 - (4 * 24 + 21) * 3600000);
      expect(lines[1]).toContain("4d 21h");
      expect(lines[1]).toMatch(/\d\d:\d\d/);
      await app.session.setModel(app.faux.getModel());
      expect(footer.get("bruv-usage")).toBeUndefined();
      await runner.emit({ type: "after_provider_response", status: 200, headers: { "x-codex-plan-type": "ignore" } });
      expect(snapshot(runner.createContext())?.plan_type).toBe("pro");
      const resumed = await make();
      try {
        await resumed.session.setModel({
          ...resumed.faux.getModel(),
          id: "codex-fixture",
          api: "openai-codex-responses",
        });
        expect(footer.get("bruv-usage")).toBe("week limit reached · using credits");
      } finally {
        await resumed.close();
      }
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
