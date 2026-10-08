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
    originalSha256: "866d65f2d42f74d2bb72ed4a755c8ace1b8a2c497a32cb57cc4db594a4fcb2bf",
    adaptedSha256: "ed4130e11c406a138a0bf4c67fdc190d674ee13d19b49093b4c77f8a741181f0",
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
    originalSha256: "231eca0304b149165a35b12730052586603f23208667e3a57355638017450175",
    adaptedSha256: "b0e06afb2d4cb5cd417196b42455ebe1c236f3a7413f79bf760963e85ff871df",
    replacements: [
      ["  ${APP_NAME} mcp <command>             Check MCP servers, sign in to or out of OAuth servers\n", ""],
      [
        "                                 Keeps MCP tools unless an entry starts with mcp__\n                                 Only +name/-name entries add to or remove from the defaults\n",
        "                                 Only +name/-name entries add to or remove from the defaults\n",
      ],
      [
        "                                 Applies to all tools, MCP tools included",
        "                                 Applies to all tools",
      ],
      [
        "  --no-mcp                       Disable built-in MCP support: no servers connect and no MCP tools\n  --skill <path>                 Load a skill file or directory (can be used multiple times)\n",
        "  --skill <path>                 Load a skill file or directory (can be used multiple times)\n",
      ],
      [
        "  # Add codemode to the default tools\n  ${APP_NAME} --tools +codemode\n\n  # Codemode with only the tools of one MCP server\n  ${APP_NAME} --tools read,bash,codemode,'mcp__radius__*'\n\n  # Disable one tool while keeping the rest available\n",
        "  # Disable one tool while keeping the rest available\n",
      ],
      ["install/remove/uninstall/update/list/config/auth/mcp", "install/remove/uninstall/update/list/config/auth"],
      ["//# sourceMappingURL=args.js.map", "export const bruvHostAdapted = true;\n//# sourceMappingURL=args.js.map"],
    ],
  },
  {
    path: "dist/core/session-manager.js",
    originalSha256: "9d01f720b803bf21d79e2b56de14d35a02316b9e22e8825fb007252a2f45f27a",
    adaptedSha256: "afa016a7535a8e6f57d516e3449cd1be3b56f08c07b05c32864b432e1c84add4",
    replacements: [
      [
        '        const rl = createInterface({\n            input: createReadStream(filePath, { encoding: "utf8", signal }),',
        '        const input = createReadStream(filePath, { encoding: "utf8", signal });\n        // Own errors even after readline closes (early return or cancellation).\n        // While open, readline forwards read errors to the iterator and catch below.\n        input.on("error", () => {});\n        const rl = createInterface({\n            input,',
      ],
      [
        '        for await (const line of rl) {\n            const entry = parseSessionEntryLine(line);\n            if (!entry)\n                continue;\n            if (!header) {\n                if (entry.type !== "session")\n                    return null;\n                header = entry;\n                continue;\n            }\n            // Extract session name (use latest, including explicit clears)\n            if (entry.type === "session_info") {\n                name = entry.name?.trim() || undefined;\n            }\n            if (entry.type !== "message")\n                continue;\n            messageCount++;\n            const activityTime = getMessageActivityTime(entry);\n            if (typeof activityTime === "number") {\n                lastActivityTime = Math.max(lastActivityTime ?? 0, activityTime);\n            }\n            const message = entry.message;\n            if (!isMessageWithContent(message))\n                continue;\n            if (message.role !== "user" && message.role !== "assistant")\n                continue;\n            const textContent = extractTextContent(message);\n            if (!textContent)\n                continue;\n            allMessages.push(textContent);\n            if (!firstMessage && message.role === "user") {\n                firstMessage = textContent;\n            }\n        }\n',
        '        try {\n            for await (const line of rl) {\n                const entry = parseSessionEntryLine(line);\n                if (!entry)\n                    continue;\n                if (!header) {\n                    if (entry.type !== "session")\n                        return null;\n                    header = entry;\n                    continue;\n                }\n                // Extract session name (use latest, including explicit clears)\n                if (entry.type === "session_info") {\n                    name = entry.name?.trim() || undefined;\n                }\n                if (entry.type !== "message")\n                    continue;\n                messageCount++;\n                const activityTime = getMessageActivityTime(entry);\n                if (typeof activityTime === "number") {\n                    lastActivityTime = Math.max(lastActivityTime ?? 0, activityTime);\n                }\n                const message = entry.message;\n                if (!isMessageWithContent(message))\n                    continue;\n                if (message.role !== "user" && message.role !== "assistant")\n                    continue;\n                const textContent = extractTextContent(message);\n                if (!textContent)\n                    continue;\n                allMessages.push(textContent);\n                if (!firstMessage && message.role === "user") {\n                    firstMessage = textContent;\n                }\n            }\n        } finally {\n            rl.close();\n            input.destroy();\n        }\n',
      ],
      [
        '    getEntries() {\n        return this.fileEntries.filter((e) => e.type !== "session");\n    }\n',
        '    getEntries() {\n        return this.fileEntries.filter((e) => e.type !== "session");\n    }\n    /** Indexed model/settings selection; disk-backed adapters avoid original bodies. */\n    getSessionSettingsBranch() { return this.getBranch(); }\n    /** Compaction-aware model entries in original branch order. */\n    getModelContextBranch() { return this.getBranch(); }\n    /** Private contiguous branch for in-memory model-context previews. */\n    getContextPreviewBranch() { return this.getBranch(); }\n    /** Original custom rows of one type on the active branch. */\n    getLatestCustomEntryOnBranch(customType, accept) {\n        return this.getBranch().reverse().find((entry) => entry.type === "custom" && entry.customType === customType && accept(entry));\n    }\n',
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
  // Native input identity and bounded model-context readers stay at the SDK seam.
  {
    path: "dist/core/agent-session.js",
    originalSha256: "0ba5c847b4fd2fd838f71ea84885b9f3a4f15d9bf4b5493e2e88a41d1507e20b",
    adaptedSha256: "3e193bae59219f79073969c2b391651e1e1e76512d2c3577d26fe3d80dd50a2b",
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
      [
        "getBranchSelection(this.sessionManager.getBranch(), getModel)",
        "getBranchSelection(this.sessionManager.getSessionSettingsBranch(), getModel)",
      ],
      [
        "estimateProjectedContextTokens(projection, this.sessionManager.getBranch()).tokens",
        "estimateProjectedContextTokens(projection, this.sessionManager.getModelContextBranch()).tokens",
      ],
      [
        "getVirtualModelState(this.sessionManager.getBranch(), model.provider, model.id)",
        "this.sessionManager.getLatestCustomEntryOnBranch(VIRTUAL_MODEL_STATE_ENTRY, (entry) => entry.data?.provider === model.provider && entry.data.modelId === model.id)?.data?.state",
      ],
      ["[...this.sessionManager.getBranch()].reverse()", "this.sessionManager.getModelContextBranch().reverse()"],
      [
        "getLatestCompactionEntry(this.sessionManager.getBranch())",
        "getLatestCompactionEntry(this.sessionManager.getModelContextBranch())",
      ],
      [
        "        const branch = this.sessionManager.getBranch();\n        const assistantIndex",
        "        const branch = this.sessionManager.getModelContextBranch();\n        const assistantIndex",
      ],
      [
        "        const projection = this.sessionManager.buildSessionProjection();\n        const branch = this.sessionManager.getBranch();",
        "        const projection = this.sessionManager.buildSessionProjection();\n        const branch = (this.sessionManager.getModelContextBranch?.() ?? this.sessionManager.getBranch());",
      ],
      [
        "        const manager = SessionManager.inMemory(this._cwd, undefined, [header, ...this.sessionManager.getBranch()]);",
        "        const manager = SessionManager.inMemory(this._cwd, undefined, [header, ...this.sessionManager.getContextPreviewBranch()]);",
      ],
      [
        "            const settings = this.settingsManager.getCompactionSettings(model);\n            const pathEntries = this.sessionManager.getBranch();",
        "            const settings = this.settingsManager.getCompactionSettings(model);\n            const pathEntries = this.sessionManager.getContextPreviewBranch();",
      ],
      [
        "            if (!model) {\n                return false;\n            }\n            const pathEntries = this.sessionManager.getBranch();",
        "            if (!model) {\n                return false;\n            }\n            const pathEntries = this.sessionManager.getContextPreviewBranch();",
      ],
      [
        "estimateProjectedContextTokens(manager.buildSessionProjection(), manager.getBranch()).tokens",
        "estimateProjectedContextTokens(manager.buildSessionProjection(), manager.getModelContextBranch()).tokens",
      ],
    ],
  },
  {
    path: "dist/core/agent-session.d.ts",
    originalSha256: "a3d494295855517aab33ca3ec3890b3e181f25b695fb656a5dd9c262f8677906",
    adaptedSha256: "438189d7af7f8ee73e87126b727dd9c93d11074f057c5ca27f02f8f67d920352",
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
  {
    path: "dist/core/session-manager.d.ts",
    originalSha256: "ea12a33701dca952d7b0860243397d30783252317e5d8b147aead6f8a1324d64",
    adaptedSha256: "51208200645f89e331998b608bff2c195b42ee6aa5dcb5e9de8143df57c6f895",
    replacements: [
      [
        "    getEntries(): SessionEntry[];",
        '    getEntries(): SessionEntry[];\n    getSessionSettingsBranch(): SessionEntry[];\n    getModelContextBranch(): SessionEntry[];\n    getContextPreviewBranch(): SessionEntry[];\n    getLatestCustomEntryOnBranch(customType: string, accept: (entry: Extract<SessionEntry, { type: "custom" }>) => boolean): Extract<SessionEntry, { type: "custom" }> | undefined;',
      ],
    ],
  },
  {
    path: "dist/core/sdk.js",
    originalSha256: "8155c0b7d819d2248a1bbf0fa4b8e40d15552ff7fa6a772154cbbccb6ae59235",
    adaptedSha256: "d97f22069117c052c9926b40cf23020fc624bf4f4a93c94fc205d9b65933968c",
    replacements: [
      [
        "const hasThinkingEntry = sessionManager.getBranch().some",
        "const hasThinkingEntry = sessionManager.getSessionSettingsBranch().some",
      ],
      [
        "getBranchSelection(sessionManager.getBranch(),",
        "getBranchSelection(sessionManager.getSessionSettingsBranch(),",
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
  if (metadata.version !== "1.1.0") throw new Error(`Unsupported Pi host version: ${metadata.version}`);
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
