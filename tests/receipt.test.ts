import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { type Receipt, registerReceipt } from "../src/receipt";
import { sdk } from "./sdk";

test("receipt frames counts, five checks and every gap within terminal width", async () => {
  initTheme("dark", false);
  const app = await sdk([
    (pi) => {
      registerReceipt(pi, () => undefined);
    },
  ]);
  try {
    const runner = app.session.extensionRunner;
    const theme = runner.createContext().ui.theme;
    const data: Receipt = {
      asked: "request-781",
      checked: Array.from({ length: 7 }, (_, i) => `case-${i}`),
      gaps: ["missing-781", "broken-781"],
      failed: false,
      changes: { files: 6, added: 182, removed: 40 },
      scripts: 10,
      calls: 41,
      agents: 2,
      elapsedSeconds: 1380,
      weekPercent: 3,
    };
    const render = (width: number) =>
      runner
        .getEntryRenderer("bruv-receipt")?.(
          { type: "custom", customType: "bruv-receipt", id: "receipt", parentId: null, timestamp: "", data },
          { expanded: false },
          theme,
        )
        ?.render(width) ?? [];
    const rows = render(100);
    const text = stripVTControlCharacters(rows.join("\n"));
    expect(rows[0]).toBe(theme.fg("accent", `╭${"─".repeat(98)}╮`));
    expect(text.match(/✓/g)).toHaveLength(5);
    expect(text.match(/✗/g)).toHaveLength(2);
    for (const value of [data.asked, ...data.checked.slice(0, 5), ...data.gaps]) expect(text).toContain(value);
    expect(text).not.toContain("case-5");
    expect(text.match(/\d+/g)?.map(Number)).toEqual([23, 41, 2, 3, 781, 0, 1, 2, 3, 4, 781, 781, 6, 182, 40]);
    for (const width of [1, 4, 12, 40, 100])
      expect(render(width).every((line) => visibleWidth(line) <= width)).toBe(true);
    data.failed = true;
    expect(render(100).length).toBe(rows.length + 1);
    data.checked = ["\x1b]2;bad-title\x07wide 界 and\nnew line"];
    expect(render(30).some((line) => line.includes("\x1b]2;"))).toBe(false);
    expect(render(30).every((line) => visibleWidth(line) <= 30)).toBe(true);
  } finally {
    await app.close();
  }
});
