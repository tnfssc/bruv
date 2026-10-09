// Whitelist projection only: never copy native MCP bearer config or full SDK input.
import fs from 'node:fs/promises';
import path from 'node:path';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: project.mjs PRIVATE_REPLAY NEW_OUTPUT');
await fs.mkdir(output,{recursive:true});
const rows=(await fs.readFile(path.join(input,'private-wire.ndjson'),'utf8')).trim().split('\n').map(JSON.parse);
const names=new Map();let n=0;
for(const row of rows)if(row.kind==='spawn')names.set(row.pid,`process-${++n}`);
const main=rows.find(row=>row.kind==='spawn'&&row.value.args.includes('--mcp-config'))?.pid;
const projected=[];
for(const row of rows){
 const base={process:names.get(row.pid),main:row.pid===main,kind:row.kind};
 if(row.kind==='spawn'){projected.push({...base,injectedMcp:row.value.args.includes('--mcp-config')});continue;}
 if(row.kind==='exit'){projected.push({...base,value:row.value});continue;}
 if(row.kind==='stderr'){
  if(/teardown failed|shutdown failed|McpOperationError|TypeError:|at async terminateSession|ConnectionRefused|MCP connection teardown/.test(row.value))projected.push({...base,value:row.value});
  continue;
 }
 if(row.kind!=='stdout')continue;
 let frame;try{frame=JSON.parse(row.value);}catch{continue;}
 const entry={...base,type:frame.type};
 if(frame.subtype)entry.subtype=frame.subtype;
 if(frame.state)entry.state=frame.state;
 if(frame.type==='result')Object.assign(entry,{is_error:frame.is_error,result:frame.result});
 if(frame.type==='system'&&frame.subtype==='init')Object.assign(entry,{version:frame.claude_code_version,mcp:frame.mcp_servers});
 const content=frame.message?.content;
 if(Array.isArray(content)){const tools=content.filter(b=>['tool_use','tool_result'].includes(b.type)).map(b=>({type:b.type,...(b.name?{name:b.name,id:b.id}: {tool_use_id:b.tool_use_id,is_error:b.is_error})}));if(tools.length)entry.tools=tools;}
 projected.push(entry);
}
await fs.writeFile(path.join(output,'wire.json'),`${JSON.stringify(projected,null,2)}\n`);
await fs.copyFile(path.join(input,'result.json'),path.join(output,'result.json'));
