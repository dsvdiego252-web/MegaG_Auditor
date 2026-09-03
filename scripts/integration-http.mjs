import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,scryptSync} from 'node:crypto';
import {setTimeout} from 'node:timers/promises';
const origin='http://127.0.0.1:3001';
const password='senha-sintetica-apenas-do-teste';
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3001'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_ENV:'production',DATABASE_URL:'',LOCAL_DATABASE_PATH:'.data/http-'+randomUUID(),ALLOW_LOCAL_DATABASE:'true',APP_ORIGIN:origin,ADMIN_EMAIL:'teste@local.test',ADMIN_PASSWORD_HASH:'test-salt:'+scryptSync(password,'test-salt',64).toString('hex'),DATA_ENCRYPTION_KEY:'b'.repeat(64)}});
let logs='';server.stdout.on('data',s=>logs+=s);server.stderr.on('data',s=>logs+=s);
let cookie='';
async function call(action,body){const r=await fetch(origin+'/api/'+action,{method:body?'POST':'GET',headers:{origin,...(cookie?{cookie}:{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});return r;}
try{
 let ready=false;for(let i=0;i<60;i++){if(server.exitCode!==null)throw new Error(logs);try{ready=(await fetch(origin)).ok;}catch{}if(ready)break;await setTimeout(300);}assert.ok(ready,'Servidor de teste não iniciou.');
 const auth=await call('login',{email:'teste@local.test',password});assert.equal(auth.status,200,await auth.clone().text());cookie=auth.headers.get('set-cookie').split(';')[0];
 const header='CFOP;Valor Contábil;Base de Cálculo;Imposto Creditado;Isentas ou Não tributadas;Outras';
 const original=header+'\r\n1102;1000,00;1000,00;120,00;0,00;0,00\r\n';
 function batch(confirm=true){const f=new FormData(),mapping=[];for(let i=1;i<=6;i++){const id=String(i).padStart(2,'0');f.append('files',new File([i===4?header:original],id+'_ApuIcms.txt'));mapping.push({companyId:id,period:'2026-08',taxMode:'confirmar',emptyConfirmed:confirm&&i===4,replace:false});}f.append('mapping',JSON.stringify(mapping));return f;}
 assert.equal((await call('import',batch(false))).status,400);
 assert.equal((await (await call('data?period=2026-08')).json()).imports.length,0);
 const preview=await call('preview',batch());assert.equal(preview.status,200);assert.equal((await preview.json()).length,6);
 const imported=await call('import',batch());assert.equal(imported.status,200,await imported.clone().text());const uploaded=await imported.json();assert.equal(uploaded.imports.length,6);
 const before=await (await call('data?period=2026-08')).json();assert.equal(before.snapshot,null);
 const processed=await call('process',{period:'2026-08'});assert.equal(processed.status,200,await processed.clone().text());
 const snapshot=(await processed.json()).snapshot;assert.equal(snapshot.entries.length,5);assert.ok(snapshot.entries.every(e=>e.category==='revisar'));assert.equal(snapshot.imports.length,6);
 assert.equal(await (await call('source?id='+uploaded.imports[0].id)).text(),original);
 const rule={cfop:'1102',companyId:'',uf:'',start:'2026-08',end:'',category:'tributada',operation:'compra',credit:'permitir',expectCredit:true,reason:'Cenário inteiramente fictício de teste de integração.',reference:'Critério exclusivo do teste',active:true};
 assert.equal((await call('rules',rule)).status,200);
 assert.equal((await (await call('data?period=2026-08')).json()).stale,true);
 const second=await (await call('process',{period:'2026-08'})).json();assert.ok(second.snapshot.entries.every(e=>e.category==='tributada'));
 const xlsx=await call('export?period=2026-08');assert.equal(xlsx.status,200);const bytes=Buffer.from(await xlsx.arrayBuffer());assert.equal(bytes.subarray(0,2).toString(),'PK');
 assert.equal((await (await call('data?period=2026-07')).json()).imports.length,0);
 assert.equal((await call('import',batch())).status,200);
 assert.equal((await (await call('data?period=2026-08')).json()).imports.length,6);
 console.log('Fluxo HTTP de produção validado em banco isolado: lote de seis arquivos, validação, atomicidade, processamento, regras, reprocessamento, origem, Excel, competência e idempotência.');
}finally{server.kill();}
