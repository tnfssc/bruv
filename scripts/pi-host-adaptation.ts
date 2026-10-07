// Keep guarded Pi fixes at the host seam. This owns inherited built-in removal,
// session scan stream cleanup, and compact-editor reservation. No saved preferences
// or global error handling are changed.
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, readFile, rename, rm, writeFile } from "node:fs/promises";
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
    originalSha256: "f48f91efc303fc7b826f0ce02ba6eb70fcc271d31671f0f68f562fdd8c6885e6",
    adaptedSha256: "4a3d92e391f2205174c71cfd30a8aed771ad9f560b80c0c6e662322f8e846e83",
    replacements: [
      [`  \${APP_NAME} mcp <command>             Check MCP servers, sign in to or out of OAuth servers\n`, ""],
      ["install/remove/uninstall/update/list/config/auth/mcp", "install/remove/uninstall/update/list/config/auth"],
      ["//# sourceMappingURL=args.js.map", "export const bruvHostAdapted = true;\n//# sourceMappingURL=args.js.map"],
    ],
  },
  {
    path: "dist/core/session-manager.js",
    originalSha256: "9d01f720b803bf21d79e2b56de14d35a02316b9e22e8825fb007252a2f45f27a",
    adaptedSha256: "344b8310365240a6e7e5573d95c8543f256bf5dadb964e954583efbe5ce75202",
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
  // Native input identity travels with Pi's actual user object through its own queues.
  {
    path: "dist/core/agent-session.js",
    originalSha256: "35ca1dabd54d98c236c9601b569c2856b726ade392d06b2eaaf50158f48913ab",
    adaptedSha256: "b6675dce26fc39803b1fe1f9deb1261cb1efc701b585cecd0ac280085dbd8eb6",
    replacements: [
      [
        "await this._queueFollowUp(expandedText, currentImages);",
        "await this._queueFollowUp(expandedText, currentImages, options?.onUserMessageCreated);",
      ],
      [
        "await this._queueSteer(expandedText, currentImages);",
        "await this._queueSteer(expandedText, currentImages, options?.onUserMessageCreated);",
      ],
      [
        '        // Inject any pending "nextTurn" messages as context alongside the user message',
        '        options?.onUserMessageCreated?.(messages[0]);\n        // Inject any pending "nextTurn" messages as context alongside the user message',
      ],
      [
        "async _queueUserInput(text, images, behavior, source)",
        "async _queueUserInput(text, images, behavior, source, onUserMessageCreated)",
      ],
      [
        "await this._queueSteer(expandedText, processedInput.images);",
        "await this._queueSteer(expandedText, processedInput.images, onUserMessageCreated);",
      ],
      [
        "await this._queueFollowUp(expandedText, processedInput.images);",
        "await this._queueFollowUp(expandedText, processedInput.images, onUserMessageCreated);",
      ],
      [
        'this._queueUserInput(text, images, "steer", options?.source ?? "interactive")',
        'this._queueUserInput(text, images, "steer", options?.source ?? "interactive", options?.onUserMessageCreated)',
      ],
      [
        'this._queueUserInput(text, images, "followUp", options?.source ?? "interactive")',
        'this._queueUserInput(text, images, "followUp", options?.source ?? "interactive", options?.onUserMessageCreated)',
      ],
      ["async _queueSteer(text, images)", "async _queueSteer(text, images, onUserMessageCreated)"],
      [
        '        this.agent.steer({\n            role: "user",\n            content,\n            timestamp: Date.now(),\n        });',
        '        const message = { role: "user", content, timestamp: Date.now() };\n        onUserMessageCreated?.(message);\n        this.agent.steer(message);',
      ],
      ["async _queueFollowUp(text, images)", "async _queueFollowUp(text, images, onUserMessageCreated)"],
      [
        '        this.agent.followUp({ role: "user", content, timestamp: Date.now() });',
        '        const message = { role: "user", content, timestamp: Date.now() };\n        onUserMessageCreated?.(message);\n        this.agent.followUp(message);',
      ],
      [
        "//# sourceMappingURL=agent-session.js.map",
        "export const bruvInputIdentityAdapted = true;\n//# sourceMappingURL=agent-session.js.map",
      ],
    ],
  },
  {
    path: "dist/core/agent-session.d.ts",
    originalSha256: "2e50b35a37f9c7149c6297ae554b2d965bd74dbfcb8ccd7be44f13226ce497e7",
    adaptedSha256: "c50ee6235e917833ac40629f34dc0974e309786dbbe123e2b73929a554d40e73",
    replacements: [
      [
        "    preflightResult?: (disposition: PromptDisposition) => void;",
        "    preflightResult?: (disposition: PromptDisposition) => void;\n    /** Bruv host seam: captures the constructed user object, NOT admission or consumption. */\n    onUserMessageCreated?: (message: AgentMessage) => void;",
      ],
      [
        "        source?: InputSource;\n    }): Promise<QueuedInputDisposition>;\n    /**\n     * Queue a follow-up",
        "        source?: InputSource;\n        /** Bruv host seam: captures the constructed user object, NOT admission or consumption. */\n        onUserMessageCreated?: (message: AgentMessage) => void;\n    }): Promise<QueuedInputDisposition>;\n    /**\n     * Queue a follow-up",
      ],
      [
        "        source?: InputSource;\n    }): Promise<QueuedInputDisposition>;\n    /**\n     * Internal: Queue a steering",
        "        source?: InputSource;\n        /** Bruv host seam: captures the constructed user object, NOT admission or consumption. */\n        onUserMessageCreated?: (message: AgentMessage) => void;\n    }): Promise<QueuedInputDisposition>;\n    /**\n     * Internal: Queue a steering",
      ],
      [
        "//# sourceMappingURL=agent-session.d.ts.map",
        "export declare const bruvInputIdentityAdapted = true;\n//# sourceMappingURL=agent-session.d.ts.map",
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
  if (metadata.version !== "1.0.3") throw new Error(`Unsupported Pi host version: ${metadata.version}`);
  // Validate every file before changing any. A dependency upgrade fails closed.
  const prepared = await Promise.all(
    piHostPatches.map(async (patch) => {
      const path = join(piRoot, patch.path);
      const before = await readFile(path, "utf8");
      return { path, before, after: adaptPiHostFile(patch, before) };
    }),
  );
  for (const { path, before, after } of prepared) {
    if (before === after) continue;
    // Bun installs may hardlink to its cache and other worktrees. Never write the
    // installed inode: copy beside it (retaining modes), adapt, then replace it.
    const temporary = `${path}.bruv-${randomUUID()}`;
    await copyFile(path, temporary, constants.COPYFILE_EXCL);
    try {
      await writeFile(temporary, after);
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
