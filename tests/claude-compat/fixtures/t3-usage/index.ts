// Unmodified official T3 v0.0.46-nightly.20261005.2702 source fixtures.
// Type-only T3 imports are erased; no T3 dependency, network or rate table is needed.
const transpiler = new Bun.Transpiler({ loader: "ts" });
async function load(name: string) {
  const source = await Bun.file(new URL(name + ".ts.txt", import.meta.url)).text();
  return import("data:text/javascript;base64," + Buffer.from(transpiler.transformSync(source)).toString("base64"));
}
export const { parseClaudeLine, mightCarryUsage } = await load("usageTranscripts");
export const { priceUsage } = await load("usagePricing");
