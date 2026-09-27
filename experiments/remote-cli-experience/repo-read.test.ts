import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readGrantedFile} from './repo-read';
test('explicit repo-root boundary, symlink escape, bounded fatal UTF-8',()=>{
 const dir=mkdtempSync(join(tmpdir(),'repo-read-'));const repo=join(dir,'repo');mkdirSync(repo);mkdirSync(join(repo,'sub'));writeFileSync(join(repo,'sub','ok.txt'),'fresh');writeFileSync(join(dir,'outside'),'private');symlinkSync(join(dir,'outside'),join(repo,'out'));symlinkSync(join(repo,'sub','ok.txt'),join(repo,'inside'));
 try{
 expect(readGrantedFile(repo,'sub/ok.txt')).toBe('fresh');expect(readGrantedFile(repo,'inside')).toBe('fresh');
 for(const path of ['../outside','/etc/passwd','out','sub/../../outside','missing'])expect(()=>readGrantedFile(repo,path)).toThrow();
 writeFileSync(join(repo,'big'),'x'.repeat(16385));expect(()=>readGrantedFile(repo,'big')).toThrow();
 writeFileSync(join(repo,'invalid'),Buffer.from([0xff]));expect(()=>readGrantedFile(repo,'invalid')).toThrow();
 }finally{rmSync(dir,{recursive:true,force:true})}
});
