// Keep guarded Pi fixes at the host seam. This owns inherited built-in removal
// and session scan stream cleanup, not user settings or global error handling.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface Patch {
  path: string;
  originalSha256: string;
  adaptedSha256: string;
  content?: string;
  replacements?: readonly (readonly [string, string])[];
}
export const piHostPatches: readonly Patch[] = [
  {
    path: "dist/extensions/index.js",
    originalSha256: "ed7f805d46160c30db9be874b2350d0bd01f8b390f94a55ec1d8d4ed9474bf9b",
    adaptedSha256: "ec465bb227a60159a8b3aa00e62f794370311a232b839cb104917da7b2651fc8",
    content:
      'import llamaExtension from "./llama/index.js";\nexport const builtInExtensions = [\n    { name: "llama.cpp", factory: llamaExtension, builtin: true },\n];\n',
  },
  {
    path: "dist/main.js",
    originalSha256: "bb36969572097bc657b85b42954a78f4be42afc5dfd63453a7d97d53165657b2",
    adaptedSha256: "246c9259bc2cb2e1f145125d0e591676bc5dab97de106c4144d6e2cf7f7586c1",
    replacements: [
      ['import { loadMcpCommand } from "./extensions/mcp/cli.lazy.js";\n', ""],
      [
        "        const { runMcpCommand } = await loadMcpCommand();\n        process.exitCode = await runMcpCommand(args.slice(1), { cwd, agentDir });",
        '        console.error("MCP is not a built-in die command.");\n        process.exitCode = 1;',
      ],
      ["//# sourceMappingURL=main.js.map", "export const dieHostAdapted = true;\n//# sourceMappingURL=main.js.map"],
    ],
  },
  {
    path: "dist/cli/args.js",
    originalSha256: "9b06126b71ef7871ba08b43eeb255788772881ab200fe587bb971306766f3c50",
    adaptedSha256: "7b203b6fd1da59e20d190e85260669d3da9a9c1800de587ecbfbfea040158311",
    replacements: [
      [`  \${APP_NAME} mcp <command>             Check MCP servers, sign in to or out of OAuth servers\n`, ""],
      ["install/remove/uninstall/update/list/config/auth/mcp", "install/remove/uninstall/update/list/config/auth"],
      ["//# sourceMappingURL=args.js.map", "export const dieHostAdapted = true;\n//# sourceMappingURL=args.js.map"],
    ],
  },
  {
    path: "dist/core/session-manager.js",
    originalSha256: "046b6a1109ac3f0ed893bb85bf0648709362fa926a5da75761216cf2fcf9d926",
    adaptedSha256: "ffabf4778848434c1d3df2314b44250cfce78f1d708b0881d78727c1a3d73b42",
    replacements: [
      [
        '        const rl = createInterface({\n            input: createReadStream(filePath, { encoding: "utf8", signal }),',
        '        const input = createReadStream(filePath, { encoding: "utf8", signal });\n        // Own errors even after readline closes (early return or cancellation).\n        // While open, readline forwards read errors to the iterator and catch below.\n        input.on("error", () => {});\n        const rl = createInterface({\n            input,',
      ],
      [
        '        for await (const line of rl) {\n            const entry = parseSessionEntryLine(line);\n            if (!entry)\n                continue;\n            if (!header) {\n                if (entry.type !== "session")\n                    return null;\n                header = entry;\n                continue;\n            }\n            // Extract session name (use latest, including explicit clears)\n            if (entry.type === "session_info") {\n                name = entry.name?.trim() || undefined;\n            }\n            if (entry.type !== "message")\n                continue;\n            messageCount++;\n            const activityTime = getMessageActivityTime(entry);\n            if (typeof activityTime === "number") {\n                lastActivityTime = Math.max(lastActivityTime ?? 0, activityTime);\n            }\n            const message = entry.message;\n            if (!isMessageWithContent(message))\n                continue;\n            if (message.role !== "user" && message.role !== "assistant")\n                continue;\n            const textContent = extractTextContent(message);\n            if (!textContent)\n                continue;\n            allMessages.push(textContent);\n            if (!firstMessage && message.role === "user") {\n                firstMessage = textContent;\n            }\n        }\n',
        '        try {\n            for await (const line of rl) {\n                const entry = parseSessionEntryLine(line);\n                if (!entry)\n                    continue;\n                if (!header) {\n                    if (entry.type !== "session")\n                        return null;\n                    header = entry;\n                    continue;\n                }\n                // Extract session name (use latest, including explicit clears)\n                if (entry.type === "session_info") {\n                    name = entry.name?.trim() || undefined;\n                }\n                if (entry.type !== "message")\n                    continue;\n                messageCount++;\n                const activityTime = getMessageActivityTime(entry);\n                if (typeof activityTime === "number") {\n                    lastActivityTime = Math.max(lastActivityTime ?? 0, activityTime);\n                }\n                const message = entry.message;\n                if (!isMessageWithContent(message))\n                    continue;\n                if (message.role !== "user" && message.role !== "assistant")\n                    continue;\n                const textContent = extractTextContent(message);\n                if (!textContent)\n                    continue;\n                allMessages.push(textContent);\n                if (!firstMessage && message.role === "user") {\n                    firstMessage = textContent;\n                }\n            }\n        } finally {\n            rl.close();\n            input.destroy();\n        }\n',
      ],
    ],
  },
];

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

export function adaptPiHostFile(patch: Patch, text: string): string {
  const digest = hash(text);
  if (digest === patch.adaptedSha256) return text;
  if (digest !== patch.originalSha256)
    throw new Error(`Unsupported Pi host file: ${patch.path}; review die's host adaptations before updating Pi`);
  let result = patch.content ?? text;
  for (const [before, after] of patch.replacements ?? []) {
    if (result.split(before).length !== 2) throw new Error(`Pi host adaptation anchor changed: ${patch.path}`);
    result = result.replace(before, after);
  }
  if (hash(result) !== patch.adaptedSha256) throw new Error(`Pi host adaptation result changed: ${patch.path}`);
  return result;
}

export async function preparePiHost(piRoot: string): Promise<void> {
  const metadata = JSON.parse(await readFile(join(piRoot, "package.json"), "utf8")) as { version: string };
  if (metadata.version !== "0.99.1") throw new Error(`Unsupported Pi host version: ${metadata.version}`);
  // Validate every file before changing any. A dependency upgrade fails closed.
  const prepared = await Promise.all(
    piHostPatches.map(async (patch) => {
      const path = join(piRoot, patch.path);
      const before = await readFile(path, "utf8");
      return { path, before, after: adaptPiHostFile(patch, before) };
    }),
  );
  for (const { path, before, after } of prepared) if (before !== after) await writeFile(path, after);
}
