import { THINKING_LEVELS } from "../../tasks/subagent-profiles";
export type RootStartupOptions = {
  place: string;
  cwd?: string;
  remoteRepo?: string;
  remoteInclude?: string[];
  model?: string;
  thinking?: string;
  projectTrusted?: boolean;
  fresh?: boolean;
};
/** Parse only the deliberate placement boundary; normal targetless startup stays byte-for-byte unchanged. */
export function parseRootPlacementArgs(args: string[]): { localArgs: string[]; remote?: RootStartupOptions } {
  const end = args.indexOf("--"),
    flags = end < 0 ? args : args.slice(0, end);
  const at = flags.indexOf("--place");
  if (at < 0) {
    if (flags.some((v) => v.startsWith("--remote-")))
      throw Error("Remote session options require --place <authorized name>");
    return { localArgs: args };
  }
  const place = flags[at + 1];
  if (!place || place.startsWith("-") || place.trim() !== place)
    throw Error("--place requires local or a human-authorized named target");
  if (flags.filter((v) => v === "--place").length !== 1) throw Error("Specify placement once");
  if (place === "local") {
    const localArgs = args.filter((_v, i) => i !== at && i !== at + 1);
    if (flags.some((v) => v.startsWith("--remote-")))
      throw Error("Remote session options cannot change local placement");
    return { localArgs };
  }
  const options: RootStartupOptions = { place };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    const takeValue = (): string => {
      const value = args[++i];
      if (!value || value.startsWith("-") || /[\r\n\0]/.test(value)) throw Error(flag + " requires a value");
      if (flag !== "--remote-include" && seen.has(flag)) throw Error("Duplicate root option: " + flag);
      seen.add(flag);
      return value;
    };
    switch (flag) {
      case "--place":
        options.place = takeValue();
        break;
      case "--approve":
      case "--no-approve":
        if (seen.has("projectTrust")) throw Error("Specify project trust once");
        seen.add("projectTrust");
        options.projectTrusted = flag === "--approve";
        break;
      // The thin client loads no packages/provider; offline startup still uses its explicit SSH target.
      case "--offline":
      case "--remote-fresh":
        if (seen.has(flag)) throw Error("Duplicate root option");
        seen.add(flag);
        if (flag === "--remote-fresh") options.fresh = true;
        break;
      case "--remote-repo": {
        const value = takeValue();
        if (!value.startsWith("/")) throw Error("Remote repository must be an absolute server path");
        options.remoteRepo = value;
        break;
      }
      case "--remote-source":
        options.cwd = takeValue();
        break;
      case "--remote-include":
        (options.remoteInclude ??= []).push(takeValue());
        break;
      case "--model":
        options.model = takeValue();
        break;
      case "--thinking": {
        const value = takeValue();
        if (!(THINKING_LEVELS as readonly string[]).includes(value)) throw Error("Unsupported root thinking override");
        options.thinking = value;
        break;
      }
      default:
        throw Error(
          "Unsupported remote main-session argument: " + flag + ". Enter prompts in the attached conversation.",
        );
    }
  }
  if (options.remoteRepo && (options.cwd || options.remoteInclude?.length))
    throw Error("Existing server workspace and local source transfer are different source choices");
  return { localArgs: [], remote: options };
}
