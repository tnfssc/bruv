// Unchanged official release validation. Runs the existing strict continuation acceptance without changing its gates.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const expected='53fbd1c78ab3a01ea91913f65dc17b9d7824f00a81564e06992a73e183054e48';
if(!process.env.T3_UPSTREAM)throw Error('Set T3_UPSTREAM to the verified isolated 2644 cache');
const binary=path.resolve(process.env.T3_UPSTREAM,'platform/t3');
if(createHash('sha256').update(await fs.readFile(binary)).digest('hex')!==expected)throw Error('Not the pinned unchanged official 2644 executable');
const root=path.resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
const here=path.join(root,'scripts/claude-native-acceptance');
const human=process.env.TRACE_SUITE==='human';
const command=process.env.TRACE_SUITE==='command';
let source=await fs.readFile(path.join(here,human?'run.mjs':'run-subagent.mjs'),'utf8');
source=source.replace('"./subagent-model.mjs"',JSON.stringify(pathToFileURL(path.join(here,'subagent-model.mjs')).href))
 .replace('const here = path.dirname(fileURLToPath(import.meta.url));','const here = '+JSON.stringify(here)+';')
 .replace('path.join(here, "subagent-driver.mjs")',JSON.stringify(fileURLToPath(new URL('./trace-driver.mjs',import.meta.url))));
if(human)source=source.replace('"./model.mjs"',JSON.stringify(pathToFileURL(path.join(here,'model.mjs')).href)).replace('path.join(here, "driver.mjs")',JSON.stringify(fileURLToPath(new URL('./trace-human-driver.mjs',import.meta.url))));
if(human) {
 const binding = `const template = path.resolve(here, "../../wisdom/claude-compat/proof/native-ui-fixture/replay.mjs");
 const replay=path.join(root,"replay.mjs");
 await fs.writeFile(replay,(await fs.readFile(template,"utf8")).replace("'./native-actions.mjs'",${JSON.stringify(JSON.stringify(pathToFileURL(path.join(root,'wisdom/claude-compat/proof/native-ui-fixture/native-actions.mjs')).href))}).replace("'../../../../scripts/claude-native-acceptance/driver.mjs'",${JSON.stringify(JSON.stringify(pathToFileURL(fileURLToPath(new URL('./trace-human-driver.mjs',import.meta.url))).href))}));`;
 source=source.replace('const replay = path.resolve(here, "../../wisdom/claude-compat/proof/native-ui-fixture/replay.mjs");',binding);
}
if(command) {
 source=source.replace('path.join(here, "subagent-driver.mjs")',JSON.stringify(fileURLToPath(new URL('./trace-command-driver.mjs',import.meta.url))));
 source=source.replace(JSON.stringify(fileURLToPath(new URL('./trace-driver.mjs',import.meta.url))),JSON.stringify(fileURLToPath(new URL('./trace-command-driver.mjs',import.meta.url))));
 const from=source.indexOf('  if (model.records.some');
 const to=source.indexOf('  passed = true;',from);
 if(from<0||to<0)throw Error('Command proof launcher boundary changed');
 source=source.slice(0,from)+'  if(model.records.length)throw Error("Unexpected model call in command-only proof");\n'+source.slice(to);
}
source=source.replaceAll('"./driver.mjs"',JSON.stringify(pathToFileURL(path.join(here,'driver.mjs')).href));
source=source.replaceAll('"./human-driver.mjs"',JSON.stringify(pathToFileURL(path.join(here,'human-driver.mjs')).href));
const scratch=path.join(root,'.cache');await fs.mkdir(scratch,{recursive:true});
const launcher=path.join(scratch,'result-boundary-run-'+process.pid+'.mjs');
await fs.writeFile(launcher,source);
let code;
try {
 const child=spawn('/usr/bin/node',[launcher],{env:process.env,stdio:'inherit'});
 code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});
} finally {
 await fs.rm(launcher);
 if(process.env.PROOF_OUTPUT) {
  const f=path.join(process.env.PROOF_OUTPUT,'result.json');
  try {
   const result=JSON.parse(await fs.readFile(f,'utf8'));
   if(result.t3BinarySha256!=='53fbd1c78ab3a01ea91913f65dc17b9d7824f00a81564e06992a73e183054e48') {
    result.diagnosisOnly=true;result.upstreamUnmodified=false;result.passed=false;code=1;
   }
   else {result.diagnosisOnly=false;result.upstreamUnmodified=true;}
   await fs.writeFile(f,JSON.stringify(result,null,2)+'\n');
  } catch {}
 }
}
process.exitCode=code??1;
