#!/usr/bin/node
import fs from 'node:fs';
import {spawn} from 'node:child_process';
const child=spawn('CONNECTOR_PLACEHOLDER',process.argv.slice(2),{env:process.env,stdio:['pipe','pipe','pipe']});
const log=(kind,value)=>fs.appendFileSync('WIRE_PLACEHOLDER',`${JSON.stringify({kind,pid:child.pid,value})}\n`);
log('spawn',{args:process.argv.slice(2),env:Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(HOME|BRUV_|CLAUDE_)/.test(k)))});
for(const [input,output,kind] of [[process.stdin,child.stdin,'stdin'],[child.stdout,process.stdout,'stdout'],[child.stderr,process.stderr,'stderr']]){
 let b='';input.on('data',c=>{output.write(c);b+=c;for(let n=b.indexOf('\n');n>=0;n=b.indexOf('\n')){log(kind,b.slice(0,n));b=b.slice(n+1)}});
 input.on('end',()=>{if(b)log(kind,b);if(kind==='stdin')output.end()});
}
child.on('close',code=>{log('exit',code);process.exit(code??1)});
process.on('SIGTERM',()=>child.kill('SIGTERM'));
