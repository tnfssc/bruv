import {test,expect} from 'bun:test';
import {EventLog,PAGE,MAX_RECORD} from './log';
import {mkdtempSync,writeFileSync,appendFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
test('durable pages, stable cursor, no full prefix response, gap and corrupt refusal',()=>{
 const dir=mkdtempSync(join(tmpdir(),'event-log-')),path=join(dir,'events');
 try{
 const log=new EventLog(path);for(let i=0;i<PAGE*3+2;i++)log.append({type:'tool',text:'line '+i});
 let page=log.page(0,'genesis');expect(page.events.length).toBe(PAGE);expect(page.total).toBe(PAGE*3+2);
 expect(()=>log.page(1,'genesis')).toThrow('gap');expect(()=>log.append({text:'x'.repeat(MAX_RECORD)})).toThrow('oversized');
 let count=0,cursor='genesis';while(count<log.count){page=log.page(count,cursor);count=page.next;cursor=page.cursor}expect(count).toBe(PAGE*3+2);
 log.close();const reloaded=new EventLog(path);expect(reloaded.page(count,cursor).events).toEqual([]);reloaded.close();
 appendFileSync(path,'{"seq":');expect(()=>new EventLog(path)).toThrow('truncated');
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('modified persisted page refused',()=>{const dir=mkdtempSync(join(tmpdir(),'event-log-')),path=join(dir,'events');try{const log=new EventLog(path);log.append({text:'hello'});const bytes=readFileSync(path).toString().replace('hello','jello');writeFileSync(path,bytes);expect(()=>log.page(0,'genesis')).toThrow('corrupt');log.close();expect(()=>new EventLog(path)).toThrow('corrupt')}finally{rmSync(dir,{recursive:true,force:true})}});
