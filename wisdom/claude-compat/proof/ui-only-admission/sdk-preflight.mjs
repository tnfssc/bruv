import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const [sdkPath, connector, normal] = process.argv.slice(2);
if (!sdkPath || !connector || !normal) throw new Error("Usage: node sdk-preflight.mjs SDK_MJS CONNECTOR_BINARY BRUV_BINARY");
const metadata = JSON.parse(await readFile(join(dirname(resolve(sdkPath)), "package.json"), "utf8"));
assert.equal(metadata.name, "@anthropic-ai/claude-agent-sdk"); assert.equal(metadata.version, "0.3.276");
const { query } = await import(pathToFileURL(resolve(sdkPath)).href);
const root = await mkdtemp(join(tmpdir(), "bruv-real-sdk-admission-"));
const home = join(root, "home"), agent = join(root, "selected-agent"), native = join(root, "native");
await mkdir(join(home, ".claude"), { recursive: true }); await mkdir(agent);
const sentinel = '{"ordinary":"untouched"}\n'; await writeFile(join(home, ".claude", "settings.json"), sentinel);
let requests = 0;
const server = createServer((req, res) => { requests++; res.writeHead(500); res.end("must not call provider"); });
await new Promise(r => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
await writeFile(join(agent, "models.json"), JSON.stringify({providers:{fixture:{baseUrl:"http://127.0.0.1:"+port+"/v1",api:"openai-completions",apiKey:"fixture-only-not-a-secret",models:[{id:"exact-model",name:"Fixture",contextWindow:32000,maxTokens:1024}]}}}));
await writeFile(join(agent, "settings.json"), '{"cacheWarming":"off"}');
const results = [];
try {
  for (const item of [
    { name: "valid", home: native, model: "fixture/exact-model" },
    { name: "missing-home", model: "fixture/exact-model", error: "explicit absolute CLAUDE_CONFIG_DIR" },
    { name: "missing-model", home: native, error: "No selected Bruv model" },
    { name: "invalid-model", home: native, model: "fixture/missing", error: "Unknown configured Bruv model" },
  ]) {
    let stderr = "";
    async function* never() { await new Promise(() => {}); }
    const abortController = new AbortController();
    const q = query({prompt:never(), options:{abortController,
      cwd:root, pathToClaudeCodeExecutable:resolve(connector), persistSession:false,
      ...(item.model ? {model:item.model} : {}), allowedTools:[], mcpServers:{}, strictMcpConfig:true,
      settingSources:["user"], settings:{disableAllHooks:true},
      env:{HOME:home, BRUV_CLAUDE_COMPAT_HOME:agent, BRUV_CLAUDE_COMPAT_BRUV_PATH:resolve(normal), CLAUDE_CONFIG_DIR:item.home},
      stderr:s=>{stderr+=s;},
    }});
    let result;
    try { result = await q.initializationResult(); await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(); }
    catch(error) { assert.ok(item.error, String(error)); assert.ok(stderr.includes(item.error), stderr+String(error)); results.push({name:item.name, rejected:true, diagnostic:item.error}); }
    finally { abortController.abort(); q.close(); }
    if (!item.error) { assert.equal(result.bruv.readiness.access_verified,false); assert.equal(result.bruv.readiness.model,"exact-model"); results.push({name:item.name, locallyConfigured:true, accessVerified:false}); }
    else assert.equal(result, undefined);
    assert.equal(requests,0);
    for (const path of [native,join(agent,"native-sessions"),join(agent,"sessions")]) await assert.rejects(access(path));
    assert.equal(await readFile(join(home,".claude","settings.json"),"utf8"),sentinel);
    assert.deepEqual(await readdir(join(home,".claude")),["settings.json"]);
  }
  console.log(JSON.stringify({sdk:"0.3.276",node:process.version,results,providerRequests:requests,ordinaryClaudeUntouched:true,nativeHistoryAllocated:false},null,2));
} finally { server.close(); await rm(root,{recursive:true,force:true}); }
