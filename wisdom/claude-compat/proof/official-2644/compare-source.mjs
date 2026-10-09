import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const cache=process.argv[2];if(!cache)throw Error('Usage: node compare-source.mjs NEW_CACHE');
await fs.mkdir(cache);
const refs={previous:'fed41fa88bb27cb4325cb208d571393850bc63c2',current:'737993303d36e10674c54b95e5bd3826682c99c7'};
const files=['pnpm-lock.yaml','pnpm-workspace.yaml','package.json','apps/server/package.json','patches/effect@4.0.0-rc.115.patch','apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts'];
const result={};
for(const [name,ref] of Object.entries(refs)) {
 result[name]={source:ref,hashes:{}};
 for(const file of files) {
  const r=await fetch(`https://raw.githubusercontent.com/pingdotgg/t3code/${ref}/${file}`);
  if(!r.ok)throw Error(`${file}: ${r.status}`);
  const bytes=Buffer.from(await r.arrayBuffer());
  const out=path.join(cache,name,file);await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,bytes);
  result[name].hashes[file]=createHash('sha256').update(bytes).digest('hex');
 }
 const lock=await fs.readFile(path.join(cache,name,'pnpm-lock.yaml'),'utf8');
 result[name].sdk=lock.match(/'@anthropic-ai\/claude-agent-sdk':\n(?: {8}.*\n){2}/)?.[0];
 result[name].sdkPackage=lock.match(/ {2}'@anthropic-ai\/claude-agent-sdk@0\.3\.276':\n(?: {4}.*\n)+/)?.[0];
 result[name].effectPatch=lock.match(/ {2}effect@4\.0\.0-rc\.115: .*/)?.[0];
}
result.sdkResolutionIdentical=result.previous.sdk===result.current.sdk && result.previous.sdkPackage===result.current.sdkPackage;
result.effectPatchByteIdentical=result.previous.hashes[files[4]]===result.current.hashes[files[4]];
const adapter=files[5];let diff;
try {diff=execFileSync('/usr/bin/diff',['-U0',path.join(cache,'previous',adapter),path.join(cache,'current',adapter)]);}
catch(e){if(e.status!==1)throw e;diff=e.stdout;}
await fs.writeFile(path.join(cache,'adapter-source.diff'),diff);
await fs.writeFile(path.join(cache,'comparison.json'),`${JSON.stringify(result,null,2)}\n`);
console.log(JSON.stringify(result,null,2));
