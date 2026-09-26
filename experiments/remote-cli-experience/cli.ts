import {readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const [cmd,...args]=process.argv.slice(2);
const path=process.env.REMOTE_CLI_STATE || '/tmp/remote-cli-experience.json';
type State={intent?:{id:string,profile:string,stage:string}, identity?:string, epoch?:number, events:any[], question?:any, answer?:{id:string,version:number,stage:string}, synced?:string, error?:string, refusal?:string, cap?:number};
const state:State=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{events:[]};
function save(){const tmp=path+'.tmp'; const fd=openSync(tmp,'w',0o600); try {writeFileSync(fd,JSON.stringify(state));fsyncSync(fd)}finally{closeSync(fd)} renameSync(tmp,path);const d=openSync(path.slice(0,path.lastIndexOf('/')+1)||'.','r');try{fsyncSync(d)}finally{closeSync(d)}}
const base='http://127.0.0.1:'+process.env.REMOTE_CLI_PORT;
async function get(p:string,body?:object){const r=await fetch(base+p,{method:body?'POST':'GET',headers:{authorization:'Bearer '+process.env.REMOTE_CLI_TOKEN,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(2500)}); const text=await r.text();if(!r.ok)throw Error('HTTP '+r.status+': '+text.slice(0,200));return JSON.parse(text)}
function local(online=false){console.log('FAKE provider fixture | bounded event prefix | owner '+(state.identity||'unobserved')+' epoch '+(state.epoch??'unobserved')+' | count '+state.events.length+'/'+(state.cap||180)+' | last sync '+(state.synced||'never')+' | '+(state.refusal||'no detected gap/overflow')); console.log('launch '+(state.intent?.id||'none')+' '+(state.intent?.stage||'not launched')+(state.error?' | '+state.error:''));if(state.question)console.log('question '+state.question.id+' '+state.question.status+' delivery '+(state.question.delivery||'not confirmed')+' '+state.question.text+(online && state.question.status==='pending' && !state.answer && !state.refusal?' (answer with: answer '+state.question.id+' A)':' (do not resend without sync confirmation)'));if(state.answer)console.log('answer '+state.answer.id+' '+state.answer.stage);}
try {
 if(cmd==='offline'||cmd==='transcript'){local();for(let i=0;i<state.events.length;i++)console.log('event '+(i+1)+' '+JSON.stringify(state.events[i]));if(cmd==='transcript')console.log('Bounded owner event prefix only; no history before owner epoch or beyond cap.');}
 else if(cmd==='connect'){const h=await get('/experience/hello');console.log('FAKE provider fixture | owner '+h.identity+' epoch '+h.epoch+' protocol '+h.protocol+' | '+h.provider+'/'+h.model+' reasoning '+h.reasoning+' | '+h.auth);}
 else if(cmd==='launch'){
   if(state.refusal?.includes('owner changed'))throw Error(state.refusal);
   if(!state.intent){state.intent={id:randomUUID(),profile:'fixture',stage:'pending'};save()}
   console.log('launch intent '+state.intent.id+' saved locally before send');
   try {const h=await get('/experience/hello');if(state.identity && (state.identity!==h.identity||state.epoch!==h.epoch)){state.refusal='owner changed: launch acceptance unknown; do not replay';save();throw Error(state.refusal)}if(!state.identity){state.identity=h.identity;state.epoch=h.epoch;save()}const a=await get('/experience/launch',{v:1,profile:state.intent.profile,id:state.intent.id,identity:state.identity,epoch:state.epoch});if(!['waiting for answer','fixture complete'].includes(state.intent.stage))state.intent.stage='accepted';save();console.log('accepted '+a.id+(a.duplicate?' (deduplicated)':''));}
   catch(e){if(String(e).includes('owner changed'))state.refusal='owner changed between hello and launch POST: acceptance unknown; do not replay';if(!['waiting for answer','fixture complete'].includes(state.intent.stage))state.intent.stage=state.refusal?'pending / acceptance unknown':/^Error: HTTP (400|409):/.test(String(e)) ? 'rejected by owner (inspect conflict)' : 'pending / acceptance unknown';save();throw e}
 }
 else if(cmd==='sync'||cmd==='status'){
   const h=await get('/experience/hello');const page=await get('/experience/events');
   if(h.identity!==page.identity||h.epoch!==page.epoch){state.refusal='owner changed during sync: unknown; no merge';save();throw Error(state.refusal)}
   if(state.identity && (state.identity!==h.identity||state.epoch!==h.epoch)){state.refusal='owner identity/epoch changed: unknown; do not replay launch';save();throw Error(state.refusal)}
   if(page.error) {state.error='owner error: '+page.error;state.refusal='overflow/gap refusal: '+page.error;save();throw Error(state.error+'; no complete transcript claim')}
   if(page.events.length<state.events.length || state.events.some((e,i)=>JSON.stringify(e)!==JSON.stringify(page.events[i]))){state.refusal='transcript gap or changed prefix at cursor '+state.events.length+'; no merge';save();throw Error(state.refusal)}
   state.identity=h.identity;state.epoch=h.epoch;state.events=page.events;state.cap=page.cap||180;state.question=page.questions?.[0];state.synced=new Date().toISOString();state.refusal=undefined; if(state.answer?.stage.startsWith('rejected') && state.question?.status==='pending')state.answer=undefined; if(state.answer && state.question?.id===state.answer.id && state.question.replyVersion===state.answer.version && state.question.status==='answered' && state.question.delivery==='delivered')state.answer.stage='delivered (sync confirmed)';
   if(state.intent && page.launchId===state.intent.id)state.intent.stage=state.question?.status==='pending'?'waiting for answer':state.question?.status==='answered'&&state.question?.delivery==='delivered'&&page.fixtureComplete?'fixture complete':'accepted';
   else if(state.intent && !['waiting for answer','fixture complete'].includes(state.intent.stage))state.intent.stage='pending / acceptance unknown';
   save();local(true);console.log('remote now: '+(state.intent?.stage||'idle')+' | cursor '+state.events.length+' / 180 bound');
 }
 else if(cmd==='answer'){
   if(state.refusal || state.answer || !state.identity || !state.question||state.question.id!==args[0]||state.question.status!=='pending')throw Error('no matching cached pending native question; sync first');
   if(args[1]!=='A')throw Error('fixture permits exact choice A only');
   const q=state.question;state.answer={id:q.id,version:q.version,stage:'sending / outcome unknown'};save();console.log('sending exact native question '+q.id+' owner '+JSON.stringify(q.owner)+' version '+q.version);
   try{await get('/answer',{id:q.id,choice:args[1],owner:q.owner,version:q.version,identity:state.identity,epoch:state.epoch});state.answer.stage='submitted / delivery unconfirmed';save();console.log('reply submitted; delivery not yet confirmed. Run sync.')}catch(e){state.answer.stage=String(e).startsWith('Error: HTTP 409')?'rejected (sync before retry)':'outcome unknown (sync before retry)';save();throw e}
 }
 else throw Error('commands: connect | launch | status | sync | transcript | offline | answer <question-id> A');
}catch(e){console.error('ERROR '+String(e));process.exitCode=1}
