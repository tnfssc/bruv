import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { agentModels, registerAgents } from "../src/agents";
import { readConfig, saveConfig } from "../src/config";
import { cacheBadge } from "../src/footer";
import { Jobs } from "../src/jobs";
import { details, registerPs } from "../src/ps";
import { sdk } from "./sdk";

test("/ps lists work, shows details and stops what is running", async () => {
  const jobs = new Jobs();
  const picks: string[][] = [];
  let step = 0;
  let shown = "";
  const app = await sdk([(pi) => registerPs(pi, jobs)], {
    select: async (_title, options) => {
      picks.push(options);
      step++;
      if (step === 1) return options.find((option) => option.includes("j2"));
      if (step === 2) return options[0];
      if (step === 3) return options.find((option) => option.includes("j2"));
      if (step === 4) return options[1];
      return undefined;
    },
    editor: async (_title, text) => {
      shown = text ?? "";
      return undefined;
    },
  });
  try {
    const done = jobs.create("job", "first", app.dir);
    jobs.append(done, "line-781\n");
    void jobs.run(done, async () => 0);
    await done.completion;
    const running = jobs.create("job", "second", app.dir);
    let finish = () => {};
    void jobs.run(running, () => new Promise<number>((resolve) => (finish = () => resolve(0))));
    const stop = jobs.stop.bind(jobs);
    jobs.stop = (id) => {
      if (id === running.id) finish();
      return stop(id);
    };
    await app.session.prompt("/ps");
    expect(picks[0][0]).toContain(running.id);
    expect(picks[0]).toHaveLength(2);
    expect(shown).toContain(running.outputPath);
    expect(picks[3]).toHaveLength(3);
    await running.completion;
    expect(details(jobs, done)).toContain("line-781");
  } finally {
    await app.close();
  }
});

test("agents may only use picked, signed-in models; /subagents saves the pick", async () => {
  let step = 0;
  const app = await sdk([(pi) => void registerAgents(pi, new Jobs())], {
    select: async (_title, options) => {
      step++;
      if (step === 1) return options.find((option) => option.startsWith(" ")) ?? options[0];
      return step === 2 ? options[0] : undefined;
    },
  });
  try {
    const ctx = app.session.extensionRunner.createContext();
    const main = `${ctx.model?.provider}/${ctx.model?.id}`;
    const all = ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`);
    expect(agentModels(ctx, {}).map((model) => `${model.provider}/${model.id}`)).toEqual([main]);
    expect(agentModels(ctx, { agentModels: ["nobody/none"] }).map((model) => `${model.provider}/${model.id}`)).toEqual([
      main,
    ]);
    saveConfig({ agentModels: undefined });
    await app.session.prompt("/subagents");
    const saved = readConfig().agentModels ?? [];
    expect(saved).toContain(main);
    if (all.length > 1) expect(saved.length).toBe(2);
  } finally {
    saveConfig({ agentModels: undefined });
    await app.close();
  }
});

test("the cache countdown counts whole minutes down to expired", () => {
  initTheme("dark", false);
  const theme = { fg: (_color: string, text: string) => text } as never;
  const start = 1_000_000;
  expect(cacheBadge(undefined, 60, start, theme)).toBe("");
  expect(stripVTControlCharacters(cacheBadge(start, 60, start + 30_000, theme)).match(/\d+/g)).toEqual(["60"]);
  expect(stripVTControlCharacters(cacheBadge(start, 60, start + 59 * 60_000 + 1, theme)).match(/\d+/g)).toEqual(["1"]);
  expect(cacheBadge(start, 60, start + 60 * 60_000, theme).match(/\d/)).toBeNull();
});
