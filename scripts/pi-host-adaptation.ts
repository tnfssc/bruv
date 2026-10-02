// Keep guarded Pi fixes at the host seam. This owns inherited built-in removal,
// session scan stream cleanup, and compact-editor reservation. No saved preferences
// or global error handling are changed.
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
    originalSha256: "060521b0b81f91948d8ded9139e423e5d0c9e6808a45c81750cc30519de4d2db",
    adaptedSha256: "b0197a0d0abb0261fac507a9e30c33a5e6a2c4fcedfd28b0d4e29fa2f30be786",
    replacements: [
      ['import { loadMcpCommand } from "./extensions/mcp/cli.lazy.js";\n', ""],
      [
        "        const { runMcpCommand } = await loadMcpCommand();\n        process.exitCode = await runMcpCommand(args.slice(1), { cwd, agentDir });",
        '        console.error("MCP is not a built-in bruv command.");\n        process.exitCode = 1;',
      ],
      ["//# sourceMappingURL=main.js.map", "export const bruvHostAdapted = true;\n//# sourceMappingURL=main.js.map"],
    ],
  },
  {
    path: "dist/cli/args.js",
    originalSha256: "2fcce7d42c5c3766c2c5a69ec582ec0f477977a527b3d01c8933bdaa537162ad",
    adaptedSha256: "714c54b8e45f2a8c606716cccab90da407e47f84f1e742dd420dc7d5606b613e",
    replacements: [
      [`  \${APP_NAME} mcp <command>             Check MCP servers, sign in to or out of OAuth servers\n`, ""],
      ["install/remove/uninstall/update/list/config/auth/mcp", "install/remove/uninstall/update/list/config/auth"],
      ["//# sourceMappingURL=args.js.map", "export const bruvHostAdapted = true;\n//# sourceMappingURL=args.js.map"],
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
  {
    path: "dist/modes/interactive/chat-viewport.js",
    originalSha256: "77ff3d8a3f20950a95cc3b758ab04ee7cffdaba5a490a2390626e781ae30f70a",
    adaptedSha256: "d8935ff445ff638165a4f11dba32eddea46191377894a8b644ee1511ef36e48f",
    replacements: [
      [
        'import { ScrollView, VStack } from "@earendil-works/pi-tui";\n',
        'import { ScrollView, VStack } from "@earendil-works/pi-tui";\nimport { getLayoutNode } from "@earendil-works/pi-tui/dist/layout-node.js";\n',
      ],
      [
        "    return {\n        transcript,\n",
        "    // The dock is reused while native dialogs replace the editor container's child.\n    // Read the active child's explicit compact marker on every layout, not at startup.\n    const editorSlot = getLayoutNode(dock).entries.find((entry) => entry.component === options.editor);\n    Object.defineProperty(editorSlot, \"minSize\", {\n        get: () => options.editor.children?.length === 1 && options.editor.children[0].bruvCompactEditor === true ? 1 : 3,\n    });\n    return {\n        transcript,\n",
      ],
      [
        "//# sourceMappingURL=chat-viewport.js.map",
        "export const bruvHostAdapted = true;\n//# sourceMappingURL=chat-viewport.js.map",
      ],
    ],
  },
];

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

export function adaptPiHostFile(patch: Patch, text: string): string {
  const digest = hash(text);
  if (digest === patch.adaptedSha256) return text;
  if (digest !== patch.originalSha256)
    throw new Error(`Unsupported Pi host file: ${patch.path}; review bruv's host adaptations before updating Pi`);
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
  if (metadata.version !== "1.0.0") throw new Error(`Unsupported Pi host version: ${metadata.version}`);
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
