export interface PerfOptions {
  samples: number;
  warmup: number;
  scales: number[];
  width: number;
  height: number;
  budgetMs: number;
  budgetExplicit: boolean;
  cases: string[];
  out?: string;
  baseline?: string;
  report?: string;
  strict: boolean;
  list: boolean;
  help: boolean;
}
export function parseOptions(args: string[]): PerfOptions {
  const options: PerfOptions = {
    samples: 40,
    warmup: 5,
    scales: [100, 500, 1000],
    width: 120,
    height: 40,
    budgetMs: 8,
    budgetExplicit: false,
    cases: [],
    strict: false,
    list: false,
    help: false,
  };
  const value = (index: number) => {
    const result = args[index + 1];
    if (!result || result.startsWith("--")) throw new Error(`Missing value for ${args[index]}`);
    return result;
  };
  const number = (text: string, flag: string, integer = true, allowZero = false) => {
    const n = Number(text);
    if (!Number.isFinite(n) || (integer && !Number.isSafeInteger(n)) || (allowZero ? n < 0 : n <= 0)) {
      throw new Error(`Invalid ${flag}: ${text}`);
    }
    return n;
  };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    switch (flag) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--list":
        options.list = true;
        break;
      case "--strict":
        options.strict = true;
        break;
      case "--samples":
        options.samples = number(value(i++), flag);
        break;
      case "--warmup":
        options.warmup = number(value(i++), flag, true, true);
        break;
      case "--width":
        options.width = number(value(i++), flag);
        break;
      case "--height":
        options.height = number(value(i++), flag);
        break;
      case "--budget":
        options.budgetExplicit = true;
        options.budgetMs = number(value(i++), flag, false);
        break;
      case "--scales":
        options.scales = [
          ...new Set(
            value(i++)
              .split(",")
              .map((part) => number(part, flag)),
          ),
        ];
        break;
      case "--case":
        options.cases.push(value(i++));
        break;
      case "--out":
        options.out = value(i++);
        break;
      case "--baseline":
        options.baseline = value(i++);
        break;
      case "--report":
        options.report = value(i++);
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }
  return options;
}
export const help = [
  "Bruv terminal frame lab — actual TUI main-thread render work, without a provider.",
  "bun run perf:terminal [options]",
  "",
  "  --list                List workload IDs",
  "  --case TEXT           Run IDs containing TEXT (repeat for a union)",
  "  --scales 100,500,1000  History/tool counts",
  "  --samples 40          Measured changes per case",
  "  --warmup 5            Warmup changes after the recorded cold frame",
  "  --width 120 --height 40",
  "  --budget 8            Strict under-budget target, in milliseconds",
  "  --strict              Exit 1 if ANY cold or steady frame misses the budget",
  "  --baseline run.json   Compare matched cases against a saved run",
  "  --report run.json     Regenerate reports without running workloads",
  "  --out DIRECTORY       Save run.json, report.txt, index.html and trace.json",
  "  -h, --help            Show this help",
  "",
].join("\n");
