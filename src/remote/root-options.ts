import { THINKING_LEVELS } from "../tasks/subagent-profiles";
export type RootStartupOptions = {
  place: string;
  cwd?: string;
  remoteRepo?: string;
  remoteInclude?: string[];
  model?: string;
  thinking?: string;
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
    // The thin client loads no packages/provider; offline startup does not prohibit its explicit SSH target.
    if (flag === "--offline") {
      if (seen.has(flag)) throw Error("Duplicate root option");
      seen.add(flag);
      continue;
    }
    if (flag === "--remote-fresh") {
      if (seen.has(flag)) throw Error("Duplicate root option");
      seen.add(flag);
      options.fresh = true;
      continue;
    }
    if (!["--place", "--remote-repo", "--remote-source", "--remote-include", "--model", "--thinking"].includes(flag))
      throw Error(
        "Unsupported remote main-session argument: " + flag + ". Enter prompts in the attached conversation.",
      );
    const value = args[++i];
    if (!value || value.startsWith("-") || /[\r\n\0]/.test(value)) throw Error(flag + " requires a value");
    if (flag !== "--remote-include" && seen.has(flag)) throw Error("Duplicate root option: " + flag);
    seen.add(flag);
    if (flag === "--remote-repo") {
      if (!value.startsWith("/")) throw Error("Remote repository must be an absolute server path");
      options.remoteRepo = value;
    } else if (flag === "--remote-source") options.cwd = value;
    else if (flag === "--remote-include") (options.remoteInclude ??= []).push(value);
    else if (flag === "--model") options.model = value;
    else if (flag === "--thinking") {
      if (!(THINKING_LEVELS as readonly string[]).includes(value)) throw Error("Unsupported root thinking override");
      options.thinking = value;
    }
  }
  if (options.remoteRepo && (options.cwd || options.remoteInclude?.length))
    throw Error("Existing server workspace and local source transfer are different source choices");
  return { localArgs: [], remote: options };
}
