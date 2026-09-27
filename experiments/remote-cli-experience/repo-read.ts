import {realpathSync, readFileSync, statSync} from 'node:fs';
import {isAbsolute, relative, resolve} from 'node:path';
export const READ_MAX=16384;
export function readGrantedFile(root:string, path:string):string {
 if(!path || isAbsolute(path) || path.split(/[\/]/).includes('..') || path.includes('\0'))throw Error('path outside granted repository');
 const base=realpathSync(root), file=realpathSync(resolve(base,path));
 const rel=relative(base,file);
 if(!rel || rel==='..' || rel.startsWith('../') || isAbsolute(rel))throw Error('path outside granted repository');
 const stat=statSync(file);
 if(!stat.isFile() || stat.size>READ_MAX)throw Error('not a bounded regular file');
 const bytes=readFileSync(file);
 if(bytes.length>READ_MAX)throw Error('file exceeds bound');
 return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
