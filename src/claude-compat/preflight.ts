import { access, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** Resolve existing ancestors without creating or migrating any state. */
async function existingAncestor(path: string): Promise<{ path: string; suffix: string[] }> {
  const suffix: string[] = [];
  let current = path;
  for (;;) {
    try {
      const canonical = await realpath(current);
      if (!(await stat(canonical)).isDirectory()) throw new Error("selected path is not a directory");
      return { path: canonical, suffix };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      suffix.unshift(relative(parent, current));
      current = parent;
    }
  }
}

/** Native stream probes must check the same home persistent turns will use. Auxiliary mode skips this. */
export async function preflightNativeHome(configDir: string | undefined, home: string): Promise<void> {
  if (!configDir || !isAbsolute(configDir) || configDir.includes("~") || configDir.includes("$HOME"))
    throw new Error(
      "Native stream setup needs an absolute CLAUDE_CONFIG_DIR. Set T3 provider homePath to a connector-owned history directory. No ~ or $HOME.",
    );
  try {
    const selected = await existingAncestor(resolve(configDir));
    const ordinary = await existingAncestor(resolve(home, ".claude"));
    const canonical = join(selected.path, ...selected.suffix);
    const claude = join(ordinary.path, ...ordinary.suffix);
    const inside = relative(claude, canonical);
    if (!inside || (inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)))
      throw new Error(
        "Refusing to write the default Claude home or its contents; select a connector-owned history directory",
      );
    await access(selected.path, constants.W_OK | constants.X_OK);
  } catch (error) {
    throw new Error(`Invalid T3 provider homePath / CLAUDE_CONFIG_DIR: ${(error as Error).message}`);
  }
}
