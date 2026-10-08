import assert from "node:assert/strict";
import { resolve } from "node:path";
import { executeIsolated } from "../../src/typescript/execution";

// This standalone assertion entry is launched only with synthetic credentials
// inside a retained owned process root. It is not a Bun test-name selection.
assert.equal(process.env.T3_MCP_URL, "http://secret.invalid/mcp");
assert.equal(process.env.T3_MCP_BEARER_TOKEN, "SECRET_EXECUTE_TOKEN");
assert.equal(process.env.BRUV_SAFE_SENTINEL, "visible");

const seen: string[] = [];
const result = await executeIsolated(
  'console.log(JSON.stringify({url:process.env.T3_MCP_URL,token:process.env.T3_MCP_BEARER_TOKEN,safe:process.env.BRUV_SAFE_SENTINEL,job:await subagent({prompt:"work",type:"fast"})}))',
  process.cwd(),
  undefined,
  3_000,
  {
    executablePath: resolve(import.meta.dir, "../../dist/bruv"),
    jobHandler: async (method) => {
      seen.push(method);
      return { id: "native-1", background: true };
    },
  },
);
assert.equal(result.exitCode, 0);
assert.deepEqual(JSON.parse(result.stdout), {
  safe: "visible",
  job: { id: "native-1", background: true },
});
assert.deepEqual(seen, ["subagent"]);
assert.ok(!result.stdout.includes("SECRET_EXECUTE_TOKEN"));
