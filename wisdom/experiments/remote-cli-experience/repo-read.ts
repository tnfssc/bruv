import {realpathSync, openSync, closeSync, fstatSync, readSync, constants} from 'node:fs';
import {isAbsolute, relative, resolve} from 'node:path';
export const READ_MAX=16384;
export function readBoundedFile(fd:number):string {
 const bytes=Buffer.alloc(READ_MAX+1);
 let size=0;
 while(size<bytes.length){const count=readSync(fd,bytes,size,bytes.length-size,null);if(!count)break;size+=count;}
 if(size>READ_MAX)throw Error('file exceeds bound');
 return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size));
}
export function readGrantedFile(root:string, path:string):string {
 if(!path || isAbsolute(path) || path.split(/[\/]/).includes('..') || path.includes('\0'))throw Error('path outside granted repository');
 const base=realpathSync(root), file=realpathSync(resolve(base,path));
 const rel=relative(base,file);
 if(!rel || rel==='..' || rel.startsWith('../') || isAbsolute(rel))throw Error('path outside granted repository');
 const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try {
  const stat=fstatSync(fd);
  if(!stat.isFile() || stat.size>READ_MAX)throw Error('not a bounded regular file');
  return readBoundedFile(fd);
 } finally {closeSync(fd);}
}
