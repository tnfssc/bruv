import {readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const [cmd,...args]=process.argv.slice(2);
const path=process.env.REMOTE_CLI_STATE || '/tmp/remote-cli-experience.json';
type State={intent?:{id:string,profile:string,stage:string}, identity?:string, epoch?:number, events:any[], question?:any, synced?:string, error?:string};
const state:State=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{events:[]};
function save(){const tmp=path+'.tmp'; const fd=openSync(tmp,'w',0o600); try {writeFileSync(fd,JSON.stringify(state));fsyncSync(fd)}finally{closeSync(fd)} renameSync(tmp,path);const d=openSync(path.slice(0,path.lastIndexOf('/')+1)||'.','r');try{fsyncSync(d)}finally{closeSync(d)}}
const base='http://127.0.0.1:'+process.env.REMOTE_CLI_PORT;
async function get(p:string,body?:object){const r=await fetch(base+p,{method:body?'POST':'GET',headers:{authorization:'Bearer '+process.env.REMOTE_CLI_TOKEN,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(2500)}); const text=await r.text();if(!r.ok)throw Error('HTTP '+r.status+': '+text.slice(0,200));return JSON.parse(text)}
function local(){console.log('FAKE provider fixture | cached '+(state.synced||'never synced')+' | '+state.events.length+' full RPC events');console.log('launch '+(state.intent?.id||'none')+' '+(state.intent?.stage||'not launched')+(state.error?' | '+state.error:''));if(state.question)console.log('question '+state.question.id+' '+state.question.status+' delivery '+(state.question.delivery||'not confirmed')+' '+state.question.text+' (answer with: answer '+state.question.id+' A)');}
try {
 if(cmd==='offline'||cmd==='transcript'){local();for(let i=0;i<state.events.length;i++)console.log('event '+(i+1)+' '+JSON.stringify(state.events[i]));if(cmd==='transcript')console.log('Full retained RPC event values above; owner bound 180 events; missing ranges are not silently skipped.');}
 else if(cmd==='connect'){const h=await get('/experience/hello');console.log('FAKE provider fixture | owner '+h.identity+' epoch '+h.epoch+' protocol '+h.protocol+' | '+h.provider+'/'+h.model+' reasoning '+h.reasoning+' | '+h.auth);}
 else if(cmd==='launch'){
   if(!state.intent){state.intent={id:randomUUID(),profile:'fixture',stage:'pending'};save()}
   console.log('launch intent '+state.intent.id+' saved locally before send');
   try {const h=await get('/experience/hello');if(state.identity && (state.identity!==h.identity||state.epoch!==h.epoch))throw Error('owner changed: unknown; do not replay launch');const a=await get('/experience/launch',{v:1,profile:state.intent.profile,id:state.intent.id});state.intent.stage='accepted';save();console.log('accepted '+a.id+(a.duplicate?' (deduplicated)':''));}
   catch(e){state.intent.stage=String(e).startsWith('Error: HTTP ') ? 'rejected by owner (inspect conflict)' : 'pending / acceptance unknown';save();throw e}
 }
 else if(cmd==='sync'||cmd==='status'){
   const h=await get('/experience/hello');const page=await get('/experience/events');
   if(h.identity!==page.identity||h.epoch!==page.epoch)throw Error('owner changed during sync: unknown; no merge');
   if(state.identity && (state.identity!==h.identity||state.epoch!==h.epoch))throw Error('owner identity/epoch changed: unknown; do not replay launch');
   if(page.error) {state.error='owner error: '+page.error;save();throw Error(state.error+'; no complete transcript claim')}
   if(page.events.length<state.events.length || state.events.some((e,i)=>JSON.stringify(e)!==JSON.stringify(page.events[i])))throw Error('transcript gap or changed prefix at cursor '+state.events.length+'; no merge');
   state.identity=h.identity;state.epoch=h.epoch;state.events=page.events;state.question=page.questions?.[0];state.synced=new Date().toISOString();
   if(state.intent && page.launchId===state.intent.id)state.intent.stage=state.question?.status==='pending'?'waiting for answer':state.question?.status==='answered'&&state.question?.delivery==='delivered'&&state.events.filter(e=>e.type==='agent_end').length>=2?'done':'accepted';
   else if(state.intent)state.intent.stage='pending / acceptance unknown';
   save();local();console.log('remote now: '+(state.intent?.stage||'idle')+' | cursor '+state.events.length+' / 180 bound');
 }
 else if(cmd==='answer'){
   if(!state.question||state.question.id!==args[0]||state.question.status!=='pending')throw Error('no matching cached pending native question; sync first');
   if(args[1]!=='A')throw Error('fixture permits exact choice A only');
   const q=state.question;console.log('sending exact native question '+q.id+' owner '+JSON.stringify(q.owner)+' version '+q.version);
   await get('/answer',{id:q.id,choice:args[1]});console.log('reply submitted; delivery not yet confirmed. Run sync.');
 }
 else throw Error('commands: connect | launch | status | sync | transcript | offline | answer <question-id> A');
}catch(e){console.error('ERROR '+String(e));process.exitCode=1}
