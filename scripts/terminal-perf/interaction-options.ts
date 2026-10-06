export const interactionGroups = ["send", "tools", "navigation"] as const;
export type InteractionGroup = (typeof interactionGroups)[number];
export interface InteractionOptions {
  groups: InteractionGroup[];
  cases: string[];
  repetitions: number;
  budget: number;
  budgetExplicit: boolean;
  width: number;
  height: number;
  out: string;
  baseline?: string;
  report?: string;
  strict: boolean;
  list: boolean;
  help: boolean;
}
export function parseInteractionOptions(args: string[]): InteractionOptions {
  const o: InteractionOptions = {
    groups: [...interactionGroups],
    cases: [],
    repetitions: 1,
    budget: 8,
    budgetExplicit: false,
    width: 100,
    height: 32,
    out: "artifacts/terminal-interactions/latest",
    strict: false,
    list: false,
    help: false,
  };
  const numeric = (text: string, flag: string, min: number, max: number, integer = true) => {
    const n = Number(text);
    if (!text.trim() || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n)))
      throw new Error("Invalid " + flag);
    return n;
  };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--strict") {
      o.strict = true;
      continue;
    }
    if (flag === "--list") {
      o.list = true;
      continue;
    }
    if (flag === "--help" || flag === "-h") {
      o.help = true;
      continue;
    }
    if (
      ![
        "--groups",
        "--cases",
        "--repetitions",
        "--budget",
        "--width",
        "--height",
        "--out",
        "--baseline",
        "--report",
      ].includes(flag)
    )
      throw new Error("Unknown option " + flag);
    const v = args[++i];
    if (!v || v.startsWith("--")) throw new Error("Missing value for " + flag);
    switch (flag) {
      case "--groups": {
        const groups = v.split(",");
        if (groups.some((g) => !interactionGroups.includes(g as InteractionGroup)))
          throw new Error("Unknown interaction group");
        o.groups = [...new Set(groups)] as InteractionGroup[];
        break;
      }
      case "--cases":
        o.cases = [...new Set(v.split(","))];
        if (o.cases.some((c) => !c)) throw new Error("Empty case");
        break;
      case "--repetitions":
        o.repetitions = numeric(v, flag, 1, 100);
        break;
      case "--budget":
        o.budget = numeric(v, flag, Number.MIN_VALUE, 10000, false);
        o.budgetExplicit = true;
        break;
      case "--width":
        o.width = numeric(v, flag, 24, 240);
        break;
      case "--height":
        o.height = numeric(v, flag, 8, 100);
        break;
      case "--out":
        o.out = v;
        break;
      case "--baseline":
        o.baseline = v;
        break;
      case "--report":
        o.report = v;
        break;
    }
  }
  return o;
}
