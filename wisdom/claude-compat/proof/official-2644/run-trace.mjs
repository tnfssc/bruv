// Unchanged official release validation. Runs the existing strict continuation acceptance without changing its gates.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const expected='53fbd1c78ab3a01ea91913f65dc17b9d7824f00a81564e06992a73e183054e48';
if(!process.env.T3_UPSTREAM)throw Error('Set T3_UPSTREAM to the verified isolated 2644 cache');
const binary=path.resolve(process.env.T3_UPSTREAM,'platform/t3');
if(createHash('sha256').update(await fs.readFile(binary)).digest('hex')!==expected)throw Error('Not the pinned unchanged official 2644 executable');
const suite=process.env.TRACE_SUITE ?? 'subagent';
let code=0;
try {
 if(suite==='human') {
  const {runAcceptance}=await import('../../../../scripts/claude-native-acceptance/run.mjs');
  await runAcceptance({driverPath:fileURLToPath(new URL('./trace-human-driver.mjs',import.meta.url))});
 } else {
  const {runSubagentAcceptance}=await import('../../../../scripts/claude-native-acceptance/run-subagent.mjs');
  await runSubagentAcceptance({
   scenario:suite,
   driverPath:fileURLToPath(new URL(suite==='command'?'./trace-command-driver.mjs':'./trace-driver.mjs',import.meta.url)),
  });
 }
} catch(error) {
 console.error(error);
 code=1;
} finally {
 if(process.env.PROOF_OUTPUT) {
  const f=path.join(process.env.PROOF_OUTPUT,'result.json');
  try {
   const result=JSON.parse(await fs.readFile(f,'utf8'));
   if(result.t3BinarySha256!=='53fbd1c78ab3a01ea91913f65dc17b9d7824f00a81564e06992a73e183054e48') {
    result.diagnosisOnly=true;result.upstreamUnmodified=false;result.passed=false;code=1;
   }
   else {result.diagnosisOnly=false;result.upstreamUnmodified=true;}
   await fs.writeFile(f,`${JSON.stringify(result,null,2)}\n`);
  } catch {}
 }
}
process.exitCode=code??1;
