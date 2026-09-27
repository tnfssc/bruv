import {EventLog,PAGE,MAX_RECORD} from './log';
import {readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, existsSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
const [cmd,...args]=process.argv.slice(2);
const path=process.env.REMOTE_CLI_STATE || '/tmp/remote-cli-experience.json';
type State={intent?:{id:string,profile:string,stage:string}, identity?:string, epoch?:number, events?:any[], cursor?:string, count?:number, question?:any, answer?:{id:string,version:number,stage:string}, synced?:string, error?:string, refusal?:string, cap?:number};
const state:State=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{cursor:"genesis",count:0};
const journal=new EventLog(path+".events");
const lagged=(state.count||0)<journal.count;
if(state.events?.length)throw Error("old bounded prefix state cannot be upgraded silently; use new state path");
if((state.count||0)>journal.count || (state.count===journal.count && state.cursor && state.cursor!==journal.cursor))throw Error("local cursor gap/corrupt journal; no complete transcript claim");
if((state.count||0)<journal.count && state.cursor && state.cursor!==journal.cursorAt(state.count||0)){throw Error("local cursor gap/corrupt journal; no complete transcript claim")}
if((state.count||0)<journal.count){state.question=undefined;state.synced=undefined;if(state.intent && ['waiting for answer','fixture complete'].includes(state.intent.stage))state.intent.stage='pending / acceptance unknown';state.refusal="local state lagged fsynced journal; metadata invalidated; sync to refresh";}
state.count=journal.count;state.cursor=journal.cursor;
function save(){const tmp=path+'.tmp'; const fd=openSync(tmp,'w',0o600); try {writeFileSync(fd,JSON.stringify(state));fsyncSync(fd)}finally{closeSync(fd)} renameSync(tmp,path);const d=openSync(path.slice(0,path.lastIndexOf('/')+1)||'.','r');try{fsyncSync(d)}finally{closeSync(d)}}
const base='http://127.0.0.1:'+process.env.REMOTE_CLI_PORT;
async function get(p:string,body?:object){const r=await fetch(base+p,{method:body?'POST':'GET',headers:{authorization:'Bearer '+process.env.REMOTE_CLI_TOKEN,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(2500)}); const reader=r.body!.getReader();let chunks:Uint8Array[]=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>PAGE*MAX_RECORD+65536){await reader.cancel();throw Error('oversized response; no merge')}chunks.push(value)}const text=Buffer.concat(chunks).toString('utf8');if(!r.ok)throw Error('HTTP '+r.status+': '+text.slice(0,200));return JSON.parse(text)}
if(lagged)save();
function hasCompletionEvent(){for(let offset=0,cursor='genesis';offset<journal.count;){const p=journal.page(offset,cursor);if(p.events.some((r:any)=>r.event?.type==='message_end' && r.event.message?.role==='assistant' && JSON.stringify(r.event.message.content).includes('SAVED ANSWER OBSERVED')))return true;offset=p.next;cursor=p.cursor}return false}
function local(online=false){console.log('FAKE provider fixture | durable paged events | owner '+(state.identity||'unobserved')+' epoch '+(state.epoch??'unobserved')+' | count '+journal.count+' persisted'+' | last observed-through sync '+(state.synced||'never')+' (owner may advance)'+' | '+(state.refusal||'no detected gap/overflow')); console.log('launch '+(state.intent?.id||'none')+' '+(state.intent?.stage||'not launched')+(state.error?' | '+state.error:''));if(state.question)console.log('native question metadata (not transcript proof) '+state.question.id+' '+state.question.status+' delivery '+(state.question.delivery||'not confirmed')+' '+state.question.text+(online && state.question.status==='pending' && !state.answer && !state.refusal?' (answer with: answer '+state.question.id+' A)':' (do not resend without sync confirmation)'));if(state.answer)console.log('answer '+state.answer.id+' '+state.answer.stage);}
try {
 if(cmd==='offline'||cmd==='transcript'){local();for(let offset=0,cursor='genesis';offset<journal.count;){const page=journal.page(offset,cursor);for(const r of page.events)console.log('event '+r.seq+' '+JSON.stringify(r.event));offset=page.next;cursor=page.cursor}if(cmd==='transcript')console.log('Persisted full owner event text; large file artifacts are separate.');}
 else if(cmd==='connect'){const h=await get('/experience/hello');console.log('FAKE provider fixture | owner '+h.identity+' epoch '+h.epoch+' protocol '+h.protocol+' | '+h.provider+'/'+h.model+' reasoning '+h.reasoning+' | '+h.auth);}
 else if(cmd==='launch'){
   if(state.refusal?.includes('owner changed'))throw Error(state.refusal);
   if(!state.intent){state.intent={id:randomUUID(),profile:'fixture',stage:'pending'};save()}
   console.log('launch intent '+state.intent.id+' saved locally before send');
   try {const h=await get('/experience/hello');if(state.identity && (state.identity!==h.identity||state.epoch!==h.epoch)){state.refusal='owner changed: launch acceptance unknown; do not replay';save();throw Error(state.refusal)}if(!state.identity){state.identity=h.identity;state.epoch=h.epoch;save()}const a=await get('/experience/launch',{v:1,profile:state.intent.profile,id:state.intent.id,identity:state.identity,epoch:state.epoch});if(!['waiting for answer','fixture complete'].includes(state.intent.stage))state.intent.stage='accepted';save();console.log('accepted '+a.id+(a.duplicate?' (deduplicated)':''));}
   catch(e){if(String(e).includes('owner changed'))state.refusal='owner changed between hello and launch POST: acceptance unknown; do not replay';if(!['waiting for answer','fixture complete'].includes(state.intent.stage))state.intent.stage=state.refusal?'pending / acceptance unknown':/^Error: HTTP (400|409):/.test(String(e)) ? 'rejected by owner (inspect conflict)' : 'pending / acceptance unknown';save();throw e}
 }
 else if(cmd==='sync'||cmd==='status'){
   const h=await get('/experience/hello');
   if(state.identity && (state.identity!==h.identity||state.epoch!==h.epoch)){state.refusal='owner identity/epoch changed: unknown; do not replay launch';save();throw Error(state.refusal)}
   let page:any, target:number|undefined;
   // A catch-up call covers the first page's high-water mark, not an ever-moving end.
   try { do {
     page=await get('/experience/events?after='+journal.count+'&cursor='+encodeURIComponent(journal.cursor)+(target===undefined?'':'&through='+target));
     if(target===undefined)target=page.total;
     if(h.identity!==page.identity||h.epoch!==page.epoch){state.refusal='owner changed during sync: unknown; no merge';save();throw Error(state.refusal)}
     if(page.error){state.error='owner error: '+page.error;state.refusal='gap refusal: '+page.error;save();throw Error(state.error+'; no complete transcript claim')}
     if(!Array.isArray(page.events)||page.events.length>PAGE||!Number.isSafeInteger(page.total)||page.total<target!||target!<journal.count||page.next!==journal.count+page.events.length||page.next>target!||page.events.length===0&&page.next<target!){throw Error('invalid page/gap; no merge')}
     for(const r of page.events){if(r.seq!==journal.count+1||r.prev!==journal.cursor||r.hash!==createHash('sha256').update(JSON.stringify({seq:r.seq,prev:r.prev,event:r.event})).digest('hex')||Buffer.byteLength(JSON.stringify(r))>MAX_RECORD)throw Error('event sequence/size gap; no merge');journal.append(r.event);if(journal.cursor!==r.hash)throw Error('event hash mismatch; no merge');state.count=journal.count;state.cursor=journal.cursor;save()}
   } while(journal.count<target!); } catch(e){state.refusal='gap/corrupt sync refusal: '+String(e);save();throw e}
   state.identity=h.identity;state.epoch=h.epoch;state.count=journal.count;state.cursor=journal.cursor;state.question=page.total===target?page.questions?.[0]:undefined;state.synced=new Date().toISOString();state.refusal=undefined; if(state.answer?.stage.startsWith('rejected') && state.question?.status==='pending')state.answer=undefined; if(state.answer && state.question?.id===state.answer.id && state.question.replyVersion===state.answer.version && state.question.status==='answered' && state.question.delivery==='delivered')state.answer.stage='delivered (sync confirmed)';
   if(state.intent && page.launchId===state.intent.id)state.intent.stage=state.question?.status==='pending'?'waiting for answer':state.question?.status==='answered'&&state.question?.delivery==='delivered'&&page.fixtureComplete && hasCompletionEvent()?'fixture complete':'accepted';
   else if(state.intent && !['waiting for answer','fixture complete'].includes(state.intent.stage))state.intent.stage='pending / acceptance unknown';
   save();local(true);console.log('remote now: '+(state.intent?.stage||'idle')+' | observed through cursor '+journal.count+' persisted (owner may advance)');
 }
 else if(cmd==='answer'){
   if(state.refusal || state.answer || !state.identity || !state.question||state.question.id!==args[0]||state.question.status!=='pending')throw Error('no matching cached pending native question; sync first');
   if(args[1]!=='A')throw Error('fixture permits exact choice A only');
   const q=state.question;state.answer={id:q.id,version:q.version,stage:'sending / outcome unknown'};save();console.log('sending exact native question '+q.id+' owner '+JSON.stringify(q.owner)+' version '+q.version);
   try{await get('/answer',{id:q.id,choice:args[1],owner:q.owner,version:q.version,identity:state.identity,epoch:state.epoch});state.answer.stage='submitted / delivery unconfirmed';save();console.log('reply submitted; delivery not yet confirmed. Run sync.')}catch(e){state.answer.stage=String(e).startsWith('Error: HTTP 409')?'rejected (sync before retry)':'outcome unknown (sync before retry)';save();throw e}
 }
 else throw Error('commands: connect | launch | status | sync | transcript | offline | answer <question-id> A');
}catch(e){console.error('ERROR '+String(e));process.exitCode=1}
