import { existsSync, readFileSync, realpathSync } from "node:fs";
import Module, { createRequire, isBuiltin } from "node:module";
import { exports as resolveExports, imports as resolveImports } from "resolve.exports";
import { init, parse as parseModules } from "es-module-lexer";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createImageHelper, IMAGE_CHANNEL_ENV } from "./images";
import { HandoffSignal, installJobGlobals, openWorkerJobBridge } from "./job-bridge";

export const INTERNAL_TYPESCRIPT_RUNNER_ARG = "--bruv-internal-execute";

function resolutionError(message: string, code: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

// Compiled Bun executables cannot reliably resolve external bare packages.
// Locate their manifests on disk, but delegate export-map semantics (including
// condition order, wildcards, and private paths) to resolve.exports.
function resolveInstalledPackage(specifier: string, cwd: string, requireMode = false): string {
  const parts = specifier.split("/");
  const packageName = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  const subpath = parts.slice(specifier.startsWith("@") ? 2 : 1).join("/");
  let directory = resolve(cwd);
  for (;;) {
    const packageDirectory = join(directory, "node_modules", packageName);
    const manifestPath = join(packageDirectory, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const exportKey = subpath ? `./${subpath}` : ".";
      const hasExports = Object.hasOwn(manifest, "exports");
      const exported = hasExports
        ? resolveExports(manifest, exportKey, { require: requireMode, conditions: ["bun"] })?.[0]
        : undefined;
      if (hasExports && !exported)
        throw resolutionError(`Package path ${specifier} is not exported`, "ERR_PACKAGE_PATH_NOT_EXPORTED");
      const target =
        exported ?? (subpath || (requireMode ? manifest.main : (manifest.module ?? manifest.main))) ?? "index.js";
      const resolved = resolve(packageDirectory, target);
      if (existsSync(resolved)) return realpathSync.native(resolved);
      for (const suffix of hasExports ? [] : [".ts", ".tsx", ".mjs", ".js", ".cjs", "/index.js"]) {
        if (existsSync(`${resolved}${suffix}`)) return realpathSync.native(`${resolved}${suffix}`);
      }
      throw resolutionError(`Cannot resolve package export ${specifier}`, "MODULE_NOT_FOUND");
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw resolutionError(`Cannot find installed package ${specifier} from ${cwd}`, "MODULE_NOT_FOUND");
}

function resolvePackageImport(specifier: string, cwd: string, requireMode = false): string {
  let directory = resolve(cwd);
  for (;;) {
    const manifestPath = join(directory, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const target = resolveImports(manifest, specifier, { require: requireMode, conditions: ["bun"] })?.[0];
      if (!target)
        throw resolutionError(`Package import ${specifier} is not defined`, "ERR_PACKAGE_IMPORT_NOT_DEFINED");
      if (target.startsWith("./")) {
        const path = resolve(directory, target);
        return existsSync(path) ? realpathSync.native(path) : path;
      }
      return resolveInstalledPackage(target, directory, requireMode);
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw resolutionError(`Cannot resolve package import ${specifier} from ${cwd}`, "ERR_PACKAGE_IMPORT_NOT_DEFINED");
}

function isEsmJavaScript(filename: string): boolean {
  if (filename.endsWith(".mjs") || filename.endsWith(".ts") || filename.endsWith(".tsx")) return true;
  if (!filename.endsWith(".js") && !filename.endsWith(".jsx")) return false;
  let directory = dirname(filename);
  for (;;) {
    const manifestPath = join(directory, "package.json");
    if (existsSync(manifestPath)) {
      return JSON.parse(readFileSync(manifestPath, "utf8")).type === "module";
    }
    const parent = dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
}

function rewriteImports(javascript: string, entryFilename: string): string {
  const [imports] = parseModules(javascript);
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  for (const imported of imports) {
    if (imported.type === "dynamic") {
      // A data URL has no filesystem-relative base. Keep every dynamic import
      // lazy and resolve it only when execution reaches the expression.
      replacements.push({
        start: imported.importStart,
        end: imported.dynamicStart,
        value: `globalThis.__bruvExecuteImportFrom.bind(null, ${JSON.stringify(dirname(entryFilename))})`,
      });
      continue;
    }
    if (imported.type === "import-meta") continue;
    const specifier = imported.specifier;
    if (isBuiltin(specifier) || specifier === "bun" || specifier.includes(":")) continue;
    const from = dirname(entryFilename);
    const resolved =
      specifier.startsWith(".") || specifier.startsWith("/")
        ? resolve(from, specifier)
        : specifier.startsWith("#")
          ? resolvePackageImport(specifier, from)
          : resolveInstalledPackage(specifier, from);
    replacements.push({ start: imported.start, end: imported.end, value: pathToFileURL(resolved).href });
  }
  let output = javascript;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end);
  }
  return output;
}

function installExecuteRequire(entryFilename: string, registerEsmGraph: (filename: string) => void): NodeJS.Require {
  const resolveRequirePackage = (specifier: string, from: string, paths?: string[]): string => {
    let lastError: unknown;
    for (const searchFrom of paths ?? [from]) {
      try {
        return specifier.startsWith("#")
          ? resolvePackageImport(specifier, searchFrom, true)
          : resolveInstalledPackage(specifier, searchFrom, true);
      } catch (error) {
        lastError = error;
        // An existing package with an invalid/private export is authoritative.
        if (!(error instanceof Error) || !error.message.startsWith("Cannot find installed package")) throw error;
      }
    }
    throw lastError;
  };

  // Keep CommonJS evaluation and caching in Bun's native loader. Only package
  // selection is customized, and every require remains anchored to its real file.
  const nativeRequire = createRequire(entryFilename);
  const resolveRequire = (specifier: string, options?: { paths?: string[] }) => {
    if (
      isBuiltin(specifier) ||
      specifier === "bun" ||
      specifier.startsWith(".") ||
      specifier.startsWith("/") ||
      specifier.includes(":")
    ) {
      return nativeRequire.resolve(specifier, options);
    }
    return resolveRequirePackage(specifier, dirname(entryFilename), options?.paths);
  };
  // Resolve before evaluating: never retry an evaluation error using an ESM
  // fallback, which could swallow the original exception or run code twice.
  const bound = ((specifier: string) => {
    const resolved = resolveRequire(specifier);
    if (isEsmJavaScript(resolved)) registerEsmGraph(resolved);
    return nativeRequire(resolved);
  }) as NodeJS.Require;
  bound.resolve = resolveRequire as NodeJS.RequireResolve;
  bound.cache = nativeRequire.cache;
  bound.extensions = nativeRequire.extensions;
  bound.main = nativeRequire.main;

  // Bun's compiled CommonJS loader can omit filesystem packages from its
  // internal resolution table. Intercept resolution only; loading, wrappers,
  // cycles, module.exports, and the cache remain entirely native.
  const moduleInternals = Module as unknown as {
    _resolveFilename: (request: string, parent?: NodeModule, isMain?: boolean, options?: unknown) => string;
  };
  const nativeResolveFilename = moduleInternals._resolveFilename;
  moduleInternals._resolveFilename = function (
    this: unknown,
    request: string,
    parent?: NodeModule,
    isMain = false,
    options?: unknown,
  ) {
    let resolved: string;
    if (
      isBuiltin(request) ||
      request === "bun" ||
      request.startsWith(".") ||
      request.startsWith("/") ||
      request.includes(":")
    ) {
      resolved = nativeResolveFilename.call(this, request, parent, isMain, options);
    } else {
      const from = parent?.filename ? dirname(parent.filename) : dirname(entryFilename);
      const paths = (options as { paths?: string[] } | undefined)?.paths;
      resolved = resolveRequirePackage(request, from, paths);
    }
    if (isEsmJavaScript(resolved)) registerEsmGraph(resolved);
    return resolved;
  };

  return bound;
}

function registerStaticEsmDependencies(
  javascript: string,
  filename: string,
  registerEsmGraph: (filename: string) => void,
): void {
  const from = dirname(filename);
  const [imports] = parseModules(javascript);
  for (const imported of imports) {
    if (imported.type !== "static" && imported.type !== "reexport-star") continue;
    const specifier = imported.specifier;
    let dependency: string;
    if (isBuiltin(specifier) || specifier === "bun" || specifier.includes(":")) {
      if (!specifier.startsWith("file:")) continue;
      dependency = fileURLToPath(specifier);
    } else {
      dependency =
        specifier.startsWith(".") || specifier.startsWith("/")
          ? resolve(from, specifier)
          : specifier.startsWith("#")
            ? resolvePackageImport(specifier, from)
            : resolveInstalledPackage(specifier, from);
    }
    registerEsmGraph(dependency);
  }
}

// Each execute child registers only its reachable ESM graph, not whole package
// directories or every ".js" file. CommonJS evaluation and caching stay native.
// Record a file before walking dependencies so cycles share its registration.
// Dynamic import and require extend this graph immediately before loading.
function createEsmGraphRegistrar(): (filename: string) => void {
  const registered = new Set<string>();
  const registerEsmGraph = (filename: string) => {
    filename = resolve(filename);
    if (existsSync(filename)) filename = realpathSync.native(filename);
    if (registered.has(filename) || !isEsmJavaScript(filename)) return;
    registered.add(filename);
    const contents = readFileSync(filename, "utf8");
    const extension = extname(filename);
    // es-module-lexer accepts JavaScript, not TypeScript. Erase types first so
    // type-only imports (including missing ones) never enter the runtime graph.
    const moduleJavascript =
      extension === ".ts" || extension === ".tsx"
        ? new Bun.Transpiler({ loader: extension === ".tsx" ? "tsx" : "ts", target: "bun" }).transformSync(contents)
        : contents;
    registerStaticEsmDependencies(moduleJavascript, filename, registerEsmGraph);
    const loader = extension === ".jsx" ? "jsx" : "js";
    const filter = new RegExp("^" + filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$");
    Bun.plugin({
      name: `bruv-execute-esm-${crypto.randomUUID()}`,
      setup(builder) {
        builder.onLoad({ filter }, () => ({ contents: rewriteImports(moduleJavascript, filename), loader }));
      },
    });
  };

  return registerEsmGraph;
}

function installPackageResolvers(registerEsmGraph: (filename: string) => void): void {
  Bun.plugin({
    name: `bruv-execute-resolver-${crypto.randomUUID()}`,
    setup(builder) {
      builder.onResolve({ filter: /^[^./#]/ }, (args) => {
        if (isBuiltin(args.path) || args.path === "bun" || args.path.includes(":")) return;
        const path = resolveInstalledPackage(args.path, dirname(args.importer), args.kind === "require-call");
        if (isEsmJavaScript(path)) registerEsmGraph(path);
        return { path };
      });
      builder.onResolve({ filter: /^#/ }, (args) => {
        const path = resolvePackageImport(args.path, dirname(args.importer), args.kind === "require-call");
        if (isEsmJavaScript(path)) registerEsmGraph(path);
        return { path };
      });
      builder.onResolve({ filter: /^\./ }, (args) => {
        if (args.kind !== "dynamic-import") return;
        const path = resolve(dirname(args.importer), args.path);
        if (!existsSync(path) || !isEsmJavaScript(path)) return;
        registerEsmGraph(path);
        return { path };
      });
    },
  });
}

export async function runTypeScriptFromStdin(): Promise<void> {
  const source = await Bun.stdin.text();
  if (!source.trim()) throw new Error("No TypeScript source was provided");

  const cwd = process.cwd();
  const entryFilename = join(cwd, "__bruv_execute__.ts");
  await init();

  const registerEsmGraph = createEsmGraphRegistrar();
  const executeRequire = installExecuteRequire(entryFilename, registerEsmGraph);

  const images = createImageHelper(process.env[IMAGE_CHANNEL_ENV] === "1");
  const jobs = installJobGlobals(openWorkerJobBridge());
  Object.assign(globalThis, {
    showImage: images.showImage,
    require: executeRequire,
    __bruvExecuteDirname: cwd,
    __bruvExecuteFilename: entryFilename,
    __bruvExecuteImportFrom: (from: string, value: unknown, options?: ImportCallOptions) => {
      const specifier = String(value);
      if (specifier.startsWith("file:")) {
        const resolved = fileURLToPath(specifier);
        if (isEsmJavaScript(resolved)) registerEsmGraph(resolved);
        return import(specifier, options);
      }
      if (isBuiltin(specifier) || specifier === "bun" || specifier.includes(":")) return import(specifier, options);
      const resolved =
        specifier.startsWith(".") || specifier.startsWith("/")
          ? resolve(from, specifier)
          : specifier.startsWith("#")
            ? resolvePackageImport(specifier, from)
            : resolveInstalledPackage(specifier, from);
      if (isEsmJavaScript(resolved)) registerEsmGraph(resolved);
      return import(pathToFileURL(resolved).href, options);
    },
  });

  const transpiler = new Bun.Transpiler({
    loader: "ts",
    target: "bun",
    define: {
      require: "globalThis.require",
      __dirname: "globalThis.__bruvExecuteDirname",
      __filename: "globalThis.__bruvExecuteFilename",
    },
  });
  const transpiled = transpiler.transformSync(source);
  const javascript = rewriteImports(transpiled, entryFilename);

  installPackageResolvers(registerEsmGraph);
  // The entry itself is in memory, but its static targets need rewriting.
  registerStaticEsmDependencies(transpiled, entryFilename, registerEsmGraph);

  const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
  try {
    try {
      await import(moduleUrl);
    } catch (error) {
      if (!(error instanceof HandoffSignal)) throw error;
    }
  } finally {
    await jobs.finish();
    await images.finish();
  }
}
