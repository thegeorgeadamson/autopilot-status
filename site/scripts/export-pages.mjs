import {access,cp,mkdir,readdir,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const output=new URL('../out/',import.meta.url);
const pages=new URL('../../docs/',import.meta.url);
await access(new URL('index.html',output));
await mkdir(pages,{recursive:true});
for(const entry of await readdir(pages))await rm(new URL(entry,pages),{recursive:true,force:true});
await cp(fileURLToPath(output),fileURLToPath(pages),{recursive:true});
console.log('Static React export copied to docs/ for GitHub Pages.');
