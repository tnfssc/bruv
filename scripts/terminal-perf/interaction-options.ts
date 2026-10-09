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
      throw new Error(`Invalid ${flag}`);
    return n;
  };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = () => {
      const text = args[++i];
      if (!text || text.startsWith("--")) throw new Error(`Missing value for ${flag}`);
      return text;
    };
    switch (flag) {
      case "--strict":
        o.strict = true;
        break;
      case "--list":
        o.list = true;
        break;
      case "--help":
      case "-h":
        o.help = true;
        break;
      case "--groups": {
        const groups = value().split(",");
        if (groups.some((g) => !interactionGroups.includes(g as InteractionGroup)))
          throw new Error("Unknown interaction group");
        o.groups = [...new Set(groups)] as InteractionGroup[];
        break;
      }
      case "--cases":
        o.cases = [...new Set(value().split(","))];
        if (o.cases.some((c) => !c)) throw new Error("Empty case");
        break;
      case "--repetitions":
        o.repetitions = numeric(value(), flag, 1, 100);
        break;
      case "--budget":
        o.budget = numeric(value(), flag, Number.MIN_VALUE, 10000, false);
        o.budgetExplicit = true;
        break;
      case "--width":
        o.width = numeric(value(), flag, 24, 240);
        break;
      case "--height":
        o.height = numeric(value(), flag, 8, 100);
        break;
      case "--out":
        o.out = value();
        break;
      case "--baseline":
        o.baseline = value();
        break;
      case "--report":
        o.report = value();
        break;
      default:
        throw new Error(`Unknown option ${flag}`);
    }
  }
  return o;
}
