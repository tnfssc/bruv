// DIAGNOSIS ONLY. Never an acceptance/product/upstream artifact.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const [official, destination] = process.argv.slice(2);
if(!destination?.includes('DIAGNOSIS') || path.resolve(official)===path.resolve(destination))throw Error('Use a distinct clearly labeled DIAGNOSIS artifact');
const expected = '2cc42990ee8ad2ff30bbd43cdcf67686c9ca5aaff5e3ed36b5be40962cc53795';
const binary = await fs.readFile(official);
if(createHash('sha256').update(binary).digest('hex') !== expected) throw Error('Wrong official artifact');
const start = binary.indexOf('const emitProviderEvent = (event)',158000000);
const end = binary.indexOf('const startTurn = fn$1("ClaudeAdapterV2.startTurn")',start);
if(start<0||end<0) throw Error('Embedded boundaries missing');
let section = binary.subarray(start,end).toString();
let helper = String.raw`
const __bdHash = (s) => typeof s === "string" ? createHash("sha256").update(s).digest("hex").slice(0,16) : null;
const __bdError = (e,depth=0) => {
 if(depth>5 || e==null) return null;
 if(e instanceof Error) return {name:e.name,message:/^(Cannot (read|convert)|.*is not a function|.*is not iterable)/.test(e.message)?e.message:"<suppressed>",stack:e.stack?.split("\n").slice(1,5).map(s=>s.replace(/\/.+?:\d+/g,"<artifact>"))};
 if(typeof e!=="object") return typeof e;
 return Object.fromEntries(Object.entries(e).filter(([k])=>!['message','payload','value'].includes(k)).slice(0,16).map(([k,v])=>[k,k==='_tag'?v:__bdError(v,depth+1)]));
};
const __bd = (stage,o={}) => {
 const c=o.context,m=o.message,q=o.liveQuery;
 console.error("BRUV_BOUNDARY_DIAG "+JSON.stringify({stage,
  context:c?{turn:__bdHash(c.providerTurnId),run:__bdHash(c.input.runId),prompt:__bdHash(c.promptUuid),echo:c.promptEcho,held:c.heldRootFrames?.length,gated:c.gatedFramesBeforeEcho,createdBy:c.input.message.createdBy,creationSource:c.input.message.creationSource,runtimeMode:c.input.runtimePolicy?.runtimeMode}:null,
  frame:m?{type:m.type,subtype:m.subtype,uuid:__bdHash(m.uuid),origin:m.origin?.kind,echo:claudeEchoedPromptUuids(m).map(__bdHash),command:__bdHash(m.command_uuid),turns:m.num_turns,stop:m.stop_reason,terminal:m.terminal_reason,parentTool:__bdHash(m.parent_tool_use_id)}:null,
  subscriber:o.subscriber,subscribers:o.subscribers,phase:o.phase,route:o.route?{allowed:o.route[0],root:__bdHash(o.state?.rootProviderTurnId),attempt:__bdHash(o.identity?.attemptId),run:__bdHash(o.identity?.runId)}:undefined,echoMode:q?.promptEchoMode,queryMatches:o.queryMatches,eventType:o.event?.type,eventStatus:o.event?.status??o.event?.providerTurn?.status,eventTurn:__bdHash(o.event?.providerTurnId??o.event?.providerTurn?.id),exit:o.exit?{tag:o.exit._tag,cause:__bdError(o.exit.cause)}:undefined,error:o.error?__bdError(o.error):undefined}));
};
globalThis.__bd=__bd;
`;
if(process.argv.includes('--sparse')) helper=helper.replace('const c=o.context,m=o.message,q=o.liveQuery;', 'if(o.message && o.message.type!=="result" && o.message.subtype!=="session_state_changed")return;if(stage==="active-context")return;const c=o.context,m=o.message,q=o.liveQuery;');
section = helper + section;
const oldEmit = 'const emitProviderEvent = (event) => offer$1(events, event).pipe(asVoid);';
section = section.replace(oldEmit,'const emitProviderEvent = (event) => (__bd("emit.construct",{event}),offer$1(events,event).pipe(asVoid));');
const funcs = [
 ['finalizeActiveTurn','emitAssistantTextArtifacts'],
 ['handleSdkMessageFrame','takeReleasableSubagentFrames'],
 ['handleRoutedSdkMessage','heldToolUseIds'],
 ['releaseHeldRootFrames','handleSdkMessage'],
 ['handleSdkMessage','canUseToolEffect'],
];
for(const [name,next] of funcs){
 const from = section.indexOf(`const ${name} =`);
 const to = section.indexOf(`const ${next} =`,from);
 if(from<0||to<0) throw Error(`Missing function ${name}`);
 let s = section.slice(from,to);
 const body = s.indexOf('{',s.indexOf('function*'));
 const tail = s.lastIndexOf('});');
 if(body<0||tail<0) throw Error(`Missing body ${name}`);
 let original = s.slice(body+1,tail);
 original = original.replace(name==='finalizeActiveTurn'?/(^[\t ]*)(yield\*)/gm:/(^[\t ]*)(return;)/gm,(_all,indent,token,offset)=>`${indent}__bd(${JSON.stringify(`${name}.line-${s.slice(0,body+1+offset).split('\n').length}`)},${name==='finalizeActiveTurn'?'{context:input.context}':name==='releaseHeldRootFrames'?'{context}':'{message:input.message}'});\n${indent}${token}`);
 const ctx = name==='finalizeActiveTurn'?'{context:input.context}':name==='releaseHeldRootFrames'?'{context}':'{message:input.message}';
 s = `${s.slice(0,body+1)}\n__bd("${name}.enter",${ctx});try{${original}}catch(error){__bd("${name}.throw",{error});throw error;}finally{__bd("${name}.leave",${ctx});}\n});${s.slice(tail+3)}`;
 section=section.slice(0,from)+s+section.slice(to);
}
// Include the actual active context in routing/frame snapshots.
section = section.replaceAll('const context = yield* get$7(activeTurn);','const context = yield* get$7(activeTurn); __bd("active-context",{context,liveQuery:yield* get$7(queryContext)});');
section = section.replace('const liveQuery = yield* get$7(queryContext);\n\t\t\t\tif (liveQuery?.query !== input.query) return;', 'const liveQuery = yield* get$7(queryContext); __bd("frame-query",{queryMatches:liveQuery?.query===input.query,liveQuery,message:input.message});\n\t\t\t\tif (liveQuery?.query !== input.query) return;');
section = section.replace('flatMap$3(fnUntraced(function* (exit) {','flatMap$3(fnUntraced(function* (exit) { __bd("query-stream-exit",{exit});');
// Reclaim only indentation of code statements, not template content. Preserve
// byte length and all embedded module offsets; never rewrite the official file.
section=section.replace(/^[\t ]+(?=(?:[a-zA-Z_$]+:|const |let |if \(|yield\* |return|__bd\(|\}|\]\)|\);))/gm,'');
if(process.argv.includes('--subscriptions-only')) section=helper+binary.subarray(start,end).toString().replace(/^[\t ]+(?=(?:[a-zA-Z_$]+:|const |let |if \(|yield\* |return|\}|\]\)|\);))/gm,'');
const size=end-start;
if(Buffer.byteLength(section)>size) throw Error(`Insufficient indentation budget ${Buffer.byteLength(section)}>${size}`);
const patch=Buffer.from(section+' '.repeat(size-Buffer.byteLength(section)));
patch.copy(binary,start);
const ms=binary.indexOf('const publishToSubscribers =');
const me=binary.indexOf('const shutdown =',ms);
let m=binary.subarray(ms,me).toString();
m=m.replace('flatMap$3((current) => forEach$1(current.values(), (queue) => offer$1(queue, signal), { discard: true }))','flatMap$3((current) => (globalThis.__bd?.("subscriber.publish",{event:signal.event,subscribers:[...current.keys()],phase:[...current].map(([id,q])=>({id,state:q.state._tag,messages:q.messages.length,takers:q.state.takers?.size,scheduled:q.scheduleRunning,pending:q.dispatcher.tasks?.buckets?.map(b=>b[1].length),running:q.dispatcher.running!==undefined}))}),forEach$1(current.values(), (queue) => offer$1(queue, signal), { discard: true })))');
m=m.replace('const close = modify$3(subscribers, (current) => {','globalThis.__bd?.("subscriber.register",{subscriber:subscriberId});const close = modify$3(subscribers, (current) => {globalThis.__bd?.("subscriber.close",{subscriber:subscriberId,subscribers:[...current.keys()]});');
m=m.replace('mapEffect$2((signal) => signal.type === "event" ? succeed$4(signal.event) : failCause$4(signal.cause))','mapEffect$2((signal) => (globalThis.__bd?.("subscriber.receive",{subscriber:subscriberId,event:signal.event}),signal.type === "event" ? succeed$4(signal.event) : failCause$4(signal.cause)))');
m=m.replace('runForEach((event) => {','runForEach((event) => {globalThis.__bd?.("manager.receive",{event});');
m=m.replace('const threadId = sessionScopedRuntimeRequestThreadId(event);','globalThis.__bd?.("manager.activity.done",{event});const threadId = sessionScopedRuntimeRequestThreadId(event);');
m=m.replace('yield* publishToSubscribers(entry.eventSubscribers, {','globalThis.__bd?.("manager.publish.before",{event});yield* publishToSubscribers(entry.eventSubscribers, {');
m=m.replace('type: "event",\n\t\t\t\t\t\tevent\n\t\t\t\t\t});','type: "event",\n\t\t\t\t\t\tevent\n\t\t\t\t\t});globalThis.__bd?.("manager.publish.after",{event});');
m=m.replace('flatMap$3((exit) => gen$1(function* () {','flatMap$3((exit) => gen$1(function* () {globalThis.__bd?.("manager.exit",{exit});');
m=m.replace(/^[\t ]+(?=(?:[a-zA-Z_$]+:|const |let |if \(|yield\* |return|globalThis\.|\}|\]\)|\);))/gm,'');
if(Buffer.byteLength(m)>me-ms)throw Error(`Manager budget ${Buffer.byteLength(m)}>${me-ms}`);
Buffer.from(m+' '.repeat(me-ms-Buffer.byteLength(m))).copy(binary,ms);
const rs=binary.indexOf('const shouldStopProviderEventIngestion =',162000000);
const re=binary.indexOf('const providerTurnStart',rs);
const rend=re>rs?re:rs+12000;
let r=binary.subarray(rs,rend).toString();
r=r.replace('(state) => routeProviderEvent(event, routeIdentity, state)', '(state) => {const route=routeProviderEvent(event,routeIdentity,state);globalThis.__bd("run.route",{event,route,state,identity:routeIdentity});return route;}');
r=r.replace('yield* trackChildLifecycle(event, deliveredEvent !== null);','yield* trackChildLifecycle(event, deliveredEvent !== null);globalThis.__bd("run.tracked",{event});');
const ps=r.indexOf('const shouldStopProviderEventIngestion =');const pe=r.indexOf('const filterAssistantEvent =',ps);const pred=r.slice(ps,pe).replaceAll('return false;','{globalThis.__bd("run.stop.result",{phase:false});return false;}').replaceAll('return true;','{globalThis.__bd("run.stop.result",{phase:true});return true;}');r=r.slice(0,ps)+pred+r.slice(pe);
r=r.replace('mapError$2((cause) => new RunExecutionIngestError({','mapError$2((cause) => new RunExecutionIngestError({diagnostic:(globalThis.__bd("run.cause",{error:cause}),undefined),');
r=r.replace('const deliveredEvent = filterAssistantEvent(event, toEpochMillis(yield* now));','const deliveredEvent = filterAssistantEvent(event, toEpochMillis(yield* now));globalThis.__bd("run.delivered",{event:deliveredEvent});');
r=r.replace('storedEventCount = (yield* providerEventIngestor.ingestNormalized({','globalThis.__bd("run.ingest.before",{event});storedEventCount = (yield* providerEventIngestor.ingestNormalized({');
r=r.replace('if (event.type === "provider_thread.updated"', 'globalThis.__bd("run.ingest.after",{event});if (event.type === "provider_thread.updated"');
r=r.replace(/^[\t ]+(?=(?:[a-zA-Z_$]+:|const |let |if \(|yield\* |return|globalThis\.|\}|\]\)|\);))/gm,'');
if(Buffer.byteLength(r)>rend-rs)throw Error('Run checkpoint budget');
Buffer.from(r+' '.repeat(rend-rs-Buffer.byteLength(r))).copy(binary,rs);
// Corrective counterfactual only: reconcile an offer made before waiter registration.
// Reuses the queue's normal scheduler; no events, statuses, reads, or timers are invented.
if(process.argv.includes('--recheck-waiter')) {
 const qs=binary.indexOf('awaitTake = (self) =>');
 const qe=binary.indexOf('//#endregion',qs);
 let q=binary.subarray(qs,qe).toString();
 if(qs<0||qe<0||!q.includes('self.state.takers.add(resume);'))throw Error('Queue waiter boundary changed');
 q=q.replace('self.state.takers.add(resume);','self.state.takers.add(resume);if(self.messages.length>0 || self.state.offers.size>0) scheduleReleaseTaker(self);').replace(/^[\t ]+/gm,'').replaceAll('\n','').replaceAll(' = ','=');
 if(Buffer.byteLength(q)>qe-qs)throw Error('Queue waiter probe budget');
 Buffer.from(q+' '.repeat(qe-qs-Buffer.byteLength(q))).copy(binary,qs);
}
await fs.mkdir(path.dirname(destination),{recursive:true});
await fs.writeFile(destination,binary,{mode:0o755});
console.log(JSON.stringify({diagnosisOnly:true,officialSha256:expected,diagnosticSha256:createHash('sha256').update(binary).digest('hex'),start,end},null,2));
