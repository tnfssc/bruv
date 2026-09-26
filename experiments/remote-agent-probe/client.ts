// Distinct short-lived viewer process. No RPC stdin or model ownership here.
const [mode,port,token]=process.argv.slice(2);
if(!['start','detach','status'].includes(mode)||!port||!token)throw Error('usage: bun client.ts start|detach|status PORT TOKEN');
const r=await fetch('http://127.0.0.1:'+port+'/'+(mode==='status'?'status':mode),{method:mode==='status'?'GET':'POST',headers:{authorization:'Bearer '+token}});
if(!r.ok)throw Error('HTTP '+r.status+': '+await r.text());
console.log(JSON.stringify(await r.json()));
