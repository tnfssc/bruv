import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync,openSync,closeSync,fstatSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readGrantedFile,readBoundedFile,READ_MAX} from './repo-read';
test('explicit repo-root boundary, symlink escape, bounded fatal UTF-8',()=>{
 const dir=mkdtempSync(join(tmpdir(),'repo-read-'));const repo=join(dir,'repo');mkdirSync(repo);mkdirSync(join(repo,'sub'));writeFileSync(join(repo,'sub','ok.txt'),'fresh');writeFileSync(join(dir,'outside'),'private');symlinkSync(join(dir,'outside'),join(repo,'out'));symlinkSync(join(repo,'sub','ok.txt'),join(repo,'inside'));
 try{
 expect(readGrantedFile(repo,'sub/ok.txt')).toBe('fresh');expect(readGrantedFile(repo,'inside')).toBe('fresh');
 for(const path of ['../outside','/etc/passwd','out','sub/../../outside','missing'])expect(()=>readGrantedFile(repo,path)).toThrow();
 writeFileSync(join(repo,'big'),'x'.repeat(16385));expect(()=>readGrantedFile(repo,'big')).toThrow();
 writeFileSync(join(repo,'invalid'),Buffer.from([0xff]));expect(()=>readGrantedFile(repo,'invalid')).toThrow();
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('read stays capped when opened file grows after metadata check',()=>{
 const dir=mkdtempSync(join(tmpdir(),'repo-read-growth-'));const file=join(dir,'file');writeFileSync(file,'ok');const fd=openSync(file,'r');
 try{expect(fstatSync(fd).size).toBe(2);appendFileSync(file,'x'.repeat(READ_MAX*4));expect(()=>readBoundedFile(fd)).toThrow('file exceeds bound');const probe=Buffer.alloc(1);expect(require('node:fs').readSync(fd,probe,0,1,null)).toBe(1);}finally{closeSync(fd);rmSync(dir,{recursive:true,force:true})}
});
