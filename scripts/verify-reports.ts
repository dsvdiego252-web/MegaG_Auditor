import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseReport} from '../lib/parser';
import {hash} from '../lib/security';
const directory=process.argv[2]||'ICMS/08-2026';
const results=[];
for(const filename of await readdir(directory)){
 if(!filename.endsWith('_ApuIcms.txt'))continue;
 const bytes=await readFile(join(directory,filename));
 const before=hash(bytes);
 try{const parsed=parseReport(bytes,{filename,companyId:filename.slice(0,2),period:'2026-08',importId:'validation',taxMode:'confirmar'});
 results.push({filename,status:'válido',rows:parsed.entries.length,warnings:parsed.warnings,originalPreserved:before===hash(await readFile(join(directory,filename)))});
 }catch(e){results.push({filename,status:'bloqueado',error:(e as Error).message,originalPreserved:before===hash(await readFile(join(directory,filename)))});}
}
await mkdir('.data',{recursive:true});await writeFile('.data/validacao-relatorios.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results.map(({filename,status,rows,originalPreserved})=>({filename,status,rows,originalPreserved})),null,2));
