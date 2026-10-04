// Diagnostic output only; never copy private-server.log into committed proof.
import fs from 'node:fs/promises';
import path from 'node:path';
import {collectReturnEvidence} from '../../../../scripts/claude-native-acceptance/subagent-return-evidence.mjs';
export async function flushCapture({proof}) {
 const config=JSON.parse(await fs.readFile(process.env.BRUV_ACCEPTANCE_CONFIG,'utf8'));
 try {await collectReturnEvidence(config,undefined,'final-provider-evidence.json');}
 catch(error) {
  if(error.code!=='ENOENT')throw error;
  await fs.writeFile(path.join(proof,'capture-error.json'),JSON.stringify({nativeExerciseNotReached:true,code:error.code,file:path.basename(error.path)},null,2)+'\n');
 }
 const log=await fs.readFile(path.join(path.dirname(config.state),'t3-runtime/private-server.log'),'utf8');
 const rows=log.split('\n').filter(l=>l.startsWith('BRUV_BOUNDARY_DIAG ')).map(l=>JSON.parse(l.slice(19)));
 await fs.writeFile(path.join(proof,'adapter-checkpoints.ndjson'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
 // Private throwaway log is local only, to diagnose capture errors without losing teardown.
 await fs.writeFile(path.join(proof,'private-log-THROWAWAY.txt'),log,{mode:0o600});
}
