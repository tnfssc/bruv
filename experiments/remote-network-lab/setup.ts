const url='http://127.0.0.1:18785/proxies';
const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'owner',listen:'0.0.0.0:8666',upstream:'owner:8080'})});
if(r.status!==201&&r.status!==409&&r.status!==200)throw Error('proxy setup '+r.status+' '+await r.text());
console.log('proxy configured: loopback 18784 -> owner:8080');
