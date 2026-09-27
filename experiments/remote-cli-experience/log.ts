import {openSync,readSync,writeSync,fsyncSync,closeSync,existsSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const MAX_RECORD=65536, PAGE=16;
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
// Complete newline-delimited, hash-chained records. Never silently repair a torn tail.
export class EventLog {
  private offsets:number[]=[];
  private hashes:string[]=[];
  private fd:number;
  private size=0;
  constructor(public path:string){
    this.fd=openSync(path,'a+');
    this.size=statSync(path).size;
    let start=0;
    while(start<this.size){
      const block=Buffer.alloc(Math.min(MAX_RECORD+1,this.size-start));
      const n=readSync(this.fd,block,0,block.length,start);
      const end=block.subarray(0,n).indexOf(10);
      if(end<0 || end>MAX_RECORD)throw Error('truncated or oversized journal record at '+start);
      const line=block.subarray(0,end).toString('utf8');
      let record:any;
      try{record=JSON.parse(line)}catch{throw Error('corrupt journal record at '+start)}
      const previous=this.hashes.at(-1)||'genesis';
      if(record.seq!==this.offsets.length+1||record.prev!==previous||record.hash!==digest(JSON.stringify({seq:record.seq,prev:record.prev,event:record.event})))throw Error('corrupt journal chain at '+start);
      this.offsets.push(start);this.hashes.push(record.hash);start+=end+1;
    }
  }
  get count(){return this.offsets.length}
  get cursor(){return this.hashes.at(-1)||'genesis'}
  append(event:any){
    const seq=this.count+1,prev=this.cursor;
    const hash=digest(JSON.stringify({seq,prev,event}));
    const line=JSON.stringify({seq,prev,event,hash})+'\n';
    if(Buffer.byteLength(line)>MAX_RECORD)throw Error('oversized journal record');
    writeSync(this.fd,line);fsyncSync(this.fd);
    this.offsets.push(this.size);this.hashes.push(hash);this.size+=Buffer.byteLength(line);
  }
  page(after:number,cursor:string){
    if(!Number.isSafeInteger(after)||after<0||after>this.count||cursor!==(after?this.hashes[after-1]:'genesis'))throw Error('gap or cursor mismatch');
    if(statSync(this.path).size!==this.size)throw Error('journal size changed or truncated');
    const events:any[]=[];
    for(let i=after;i<Math.min(this.count,after+PAGE);i++){
      const length=(this.offsets[i+1]??this.size)-this.offsets[i];
      if(length>MAX_RECORD)throw Error('oversized journal page record');
      const buf=Buffer.alloc(length);if(readSync(this.fd,buf,0,length,this.offsets[i])!==length)throw Error('truncated journal page');
      let r:any;try{r=JSON.parse(buf.toString('utf8'))}catch{throw Error('corrupt journal page')}
      if(r.seq!==i+1||r.prev!==(this.hashes[i-1]||'genesis')||r.hash!==this.hashes[i]||r.hash!==digest(JSON.stringify({seq:r.seq,prev:r.prev,event:r.event})))throw Error('corrupt journal page');
      events.push(r);
    }
    return {events,next:after+events.length,cursor:this.hashes[after+events.length-1]||'genesis',total:this.count};
  }
  close(){closeSync(this.fd)}
}
