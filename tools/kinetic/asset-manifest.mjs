import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const files=[];
async function visit(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=`${dir}/${e.name}`;if(e.isDirectory())await visit(p);else files.push(p);}}
for(const d of ['public/models','public/kinetic','public/sfx','public/licenses'])await visit(d);
const assets=[];for(const path of files.sort()){const b=await readFile(path);assets.push({path,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});}
await writeFile('docs/asset-manifest.json',JSON.stringify({version:1,assets},null,2)+'\n');
console.log(`${assets.length} assets fingerprinted`);
