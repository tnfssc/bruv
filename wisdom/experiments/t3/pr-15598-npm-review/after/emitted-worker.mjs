#!/usr/bin/env node

import { t as runClaudeHistoryWorker } from "./claudeHistoryWorker-DAUbt0yx.mjs";
//#region src/claude-history-worker.ts
const [method, sessionId, rawOptions] = process.argv.slice(2);
await runClaudeHistoryWorker(method, sessionId, rawOptions);
//#endregion
export {};

//# sourceMappingURL=claude-history-worker.mjs.map