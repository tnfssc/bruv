#!/usr/bin/env node
// Research-only Claude-compatible protocol fixture. NOT Claude, NOT authenticated.
// Independently authored from public SDK types and discovery.ndjson.
import fs from 'node:fs';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
const log=x=>process.env.SPIKE_LOG && fs.appendFileSync(process.env.SPIKE_LOG,`${JSON.stringify(x)}\n`,{mode:0o600});
// MCP config can contain private pairing material: never record argument values.
log({kind:'spawn',flags:process.argv.slice(2).filter(x=>x.startsWith('--')&&!x.includes('=')).map(x=>x),fixtureMode:process.env.SPIKE_PROTOCOL_ONLY==='1'});
if(process.argv.includes('--version')) { console.log('Research Claude-compatible fixture 0.0.1 (not authenticated Claude)'); process.exit(0); }
if(process.argv.includes('auth')) { console.log(JSON.stringify({loggedIn:process.env.SPIKE_PROTOCOL_ONLY==='1',authMethod:'local-research-fixture',fixture:true,providerCalls:0})); process.exit(process.env.SPIKE_PROTOCOL_ONLY==='1'?0:1); }
const sid=process.argv.includes('--resume') ? process.argv[process.argv.indexOf('--resume')+1] : randomUUID();
const send=x=>{log({kind:'stdout',value:x}); process.stdout.write(`${JSON.stringify(x)}\n`);};
const event=x=>send({...x,uuid:randomUUID(),session_id:sid});
const reply=(id,response)=>send({type:'control_response',response:{subtype:'success',request_id:id,response}});
let pending, taskId;
function finish(text,status="completed"){
 event({type:'system',subtype:'task_notification',task_id:taskId,status,output_file:'',summary:`Synthetic fixture task ${status}; no provider call`});
 event({type:'stream_event',parent_tool_use_id:null,event:{type:'content_block_stop',index:0}});
 event({type:'stream_event',parent_tool_use_id:null,event:{type:'message_stop'}});
 event({type:'assistant',parent_tool_use_id:null,message:{id:randomUUID(),type:'message',role:'assistant',model:'research-fixture',content:[{type:'text',text}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:0,output_tokens:0}}});
 event({type:'result',subtype:'success',is_error:false,result:text,stop_reason:'end_turn',duration_ms:150,duration_api_ms:0,num_turns:1,total_cost_usd:0,usage:{input_tokens:0,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0},modelUsage:{},permission_denials:[]});
 taskId=null;
}
const lines=readline.createInterface({input:process.stdin});
lines.on('line',line=>{
 const m=JSON.parse(line); log({kind:'stdin',value:m});
 if(m.type==='control_request'){
  if(m.request.subtype==='initialize' && process.env.SPIKE_PROTOCOL_ONLY!=='1') send({type:'control_response',response:{subtype:'error',request_id:m.request_id,error:'Research fixture is not authenticated Claude. Protocol-only driver opt-in required; no real provider auth available.'}});
  else if(m.request.subtype==='initialize') reply(m.request_id,{commands:[],agents:[],output_style:'research-fixture',available_output_styles:['research-fixture'],models:[]});
  else if(m.request.subtype==='get_usage') reply(m.request_id,{rate_limits_available:false,rate_limits:{}});
  else if(m.request.subtype==='set_model' || m.request.subtype==='set_permission_mode') reply(m.request_id,{});
  else if(m.request.subtype==='interrupt'){clearTimeout(pending); reply(m.request_id,{}); finish('Research fixture interrupted (synthetic; not provider inference)','stopped');}
  else send({type:'control_response',response:{subtype:'error',request_id:m.request_id,error:`Research fixture does not implement ${m.request.subtype}`}});
 }
 if(m.type==='user'){
  if(process.env.SPIKE_PROTOCOL_ONLY!=='1'){console.error('Explicit local fixture mode required; no provider inference available.');process.exit(1);}
  clearTimeout(pending);
  if(taskId) event({type:'system',subtype:'task_notification',task_id:taskId,status:'stopped',output_file:'',summary:'Synthetic task superseded by native steering; not Bruv execution'});
  taskId=`synthetic-${randomUUID()}`;
  const text=`Bruv Claude-protocol research fixture: ${JSON.stringify(m.message.content)} (synthetic; no Bruv execution or provider call).`;
  event({type:'system',subtype:'task_started',task_id:taskId,description:'Synthetic monitor/subagent interoperability task (not Bruv execution)',task_type:'local_agent',is_backgrounded:false});
  event({type:'stream_event',parent_tool_use_id:null,event:{type:'message_start',message:{id:randomUUID(),type:'message',role:'assistant',model:'research-fixture',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:0,output_tokens:0}}}});
  event({type:'stream_event',parent_tool_use_id:null,event:{type:'content_block_start',index:0,content_block:{type:'text',text:''}}});
  event({type:'stream_event',parent_tool_use_id:null,event:{type:'content_block_delta',index:0,delta:{type:'text_delta',text}}});
  event({type:'system',subtype:'task_progress',task_id:taskId,description:'Synthetic monitor progress (not Bruv execution)',usage:{total_tokens:0,tool_uses:0,duration_ms:0}});
  pending=setTimeout(()=>finish(text),JSON.stringify(m.message.content).includes('controlled')?60000:150);
 }
});
lines.on('close',()=>{log({kind:'lifecycle',event:'stdin-close'});clearTimeout(pending);process.exit(0);});
process.on('SIGTERM',()=>{log({kind:'lifecycle',event:'SIGTERM'});process.exit(0);});
setTimeout(()=>process.exit(2),180000).unref();
