import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { demoData } from '@/lib/demo';
import {loadData,importFiles,processPeriod,saveRule,saveCompany,setPeriodDeclaration,periodSchema} from '@/lib/store';
import {checkOrigin,requireAuth,login,logout,sessionCookie,HttpError,decrypt} from '@/lib/security';
import {database} from '@/lib/db';
import {importTaxPackage,saveTaxRule} from '@/lib/tax-store';
import type {TaxPackage} from '@/lib/tax-motor';
import {databaseDiagnostic} from '@/lib/db-diagnostics';
import {parseReport,ImportError,MAX_FILE_BYTES} from '@/lib/parser';
import {excelExport,reportExport} from '@/lib/export';
import type {ImportRecord} from '@/lib/types';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>{
  if(Buffer.byteLength(JSON.stringify(data),'utf8')>4_000_000) return NextResponse.json({error:'Resultado acima do limite da versão. Reduza o escopo ou utilize relatórios resumidos.'},{status:413,headers:{'Cache-Control':'no-store'}});
  return NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
};
async function boundedRequest(req:Request,max:number) {
  const reader=req.body?.getReader();if(!reader)return req;
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>max){await reader.cancel();throw new HttpError('Requisição acima do limite permitido.',413);}chunks.push(part.value);}
  return new Request(req.url,{method:'POST',headers:req.headers,body:Buffer.concat(chunks)});
}
function fail(e:unknown) {
  if(e instanceof z.ZodError) return json({error:'Dados inválidos: '+e.issues.map(i=>i.path.join('.')+': '+i.message).join(' ')},400);
  if(e instanceof HttpError) return json({error:e.message},e.status);
  if(e instanceof ImportError) return json({error:e.message,lines:e.lines},422);
  const diagnostic=databaseDiagnostic(e);
  if(diagnostic) {
    console.error('Mega G: falha de conexão com o banco',diagnostic.code);
    return json({error:diagnostic.message+' Código: '+diagnostic.code+'.'},503);
  }
  console.error('Mega G: falha de operação',e instanceof Error?e.name:'Unknown', e instanceof WebAssembly.RuntimeError ? e.message : '');
  return json({error:'Não foi possível concluir a operação. Verifique a configuração do banco e tente novamente.'},500);
}
export async function GET(req:Request,{params}:{params:Promise<{action:string}>}) {
  try {
    const {action}=await params;
    const url=new URL(req.url);
    const demo=url.searchParams.get('mode')==='demo';
    if(!demo) await requireAuth(req);
    if(action==='session') return json({authenticated:!demo});
    if(action==='tax-source'||action==='tax-history') {
      if(demo) throw new HttpError('O motor real exige autenticação.',401);
      const id=z.string().uuid().parse(url.searchParams.get('id'));
      const db=await database();
      if(action==='tax-history')return json((await db.query<{payload:unknown}>('SELECT payload FROM mega_tax_revisions WHERE rule_id=$1 ORDER BY version DESC LIMIT 50',[id])).map(r=>r.payload));
      const [row]=await db.query<{source:string;payload:TaxPackage}>('SELECT source,payload FROM mega_tax_packages WHERE id=$1',[id]);
      if(!row)throw new HttpError('Pacote não encontrado.',404);
      return new Response(new Uint8Array(decrypt(row.source)),{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(row.payload.filename),'Cache-Control':'no-store'}});
    }
    if(action==='source') {
      if(demo) throw new HttpError('A demonstração não contém arquivos reais.',404);
      const [row]=await (await database()).query<{source:string;payload:ImportRecord}>('SELECT source,payload FROM mega_imports WHERE id=$1',[url.searchParams.get('id')||'']);
      if(!row) throw new HttpError('Arquivo não encontrado.',404);
      return new Response(new Uint8Array(decrypt(row.source)),{headers:{'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(row.payload.filename),'Cache-Control':'no-store'}});
    }
    if(!['data','export','report','history'].includes(action)) throw new HttpError('Rota não encontrada.',404);
    const period=periodSchema.parse(url.searchParams.get('period')||'2026-08');
    if(action==='history') {
      if(demo) return json([]);
      return json(await (await database()).query('SELECT id,created_at,payload->\'imports\' as imports,payload->\'ruleFingerprint\' as rules FROM mega_snapshots WHERE period=$1 ORDER BY created_at DESC LIMIT 20',[period]));
    }
    const data=demo?demoData(period):await loadData(period);
    if(action==='data') {
      // Nunca entregar linhas ainda não processadas: o dashboard representa uma versão explícita.
      return json({demo:data.demo,companies:data.companies,rules:data.rules,taxRules:data.taxRules||[],taxPackages:data.taxPackages||[],imports:data.imports,snapshot:data.snapshot,stale:data.stale,periods:data.periods,declarations:data.declarations||[]});
    }
    if(!data.snapshot) throw new HttpError('Processe a competência antes de exportar.');
    const company=url.searchParams.get('company')||'all';
    if(company!=='all'&&!data.companies.some(c=>c.id===company)) throw new HttpError('Empresa inválida.');
    const prefix=demo?'DEMO_':'';
    if(action==='export') return new Response(new Uint8Array(await excelExport(data,company)),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="'+prefix+'MegaG_'+period+'.xlsx"','Cache-Control':'no-store'}});
    return new Response(reportExport(data,company),{headers:{'Content-Type':'text/html; charset=utf-8','Content-Disposition':'attachment; filename="'+prefix+'Auditoria_'+period+'.html"','Cache-Control':'no-store'}});
  } catch(e){return fail(e);}
}
export async function POST(req:Request,{params}:{params:Promise<{action:string}>}) {
  try {
    checkOrigin(req);
    const {action}=await params;
    const contentLength=Number(req.headers.get('content-length')||0);
    if(contentLength>4_000_000) throw new HttpError('O lote excede 4 MB. Importe em lotes menores.',413);
    req=await boundedRequest(req,action==='login'?4096:action==='tax-package'?270_000:action==='tax-rule'?64_000:action==='import'||action==='preview'?4_000_000:20_000);
    if(action==='login') {
      const {email,password}=z.object({email:z.string().email().max(200),password:z.string().min(1).max(200)}).parse(await req.json());
      const result=await login(email,password);
      if(result.error) return json({error:result.error},result.status);
      return NextResponse.json({ok:true},{headers:{'Set-Cookie':sessionCookie(result.token!),'Cache-Control':'no-store'}});
    }
    await requireAuth(req);
    if(action==='logout') {await logout(req);return NextResponse.json({ok:true},{headers:{'Set-Cookie':sessionCookie('',0)}});}
    const actor=process.env.ADMIN_EMAIL||'admin';
    if(action==='tax-package') {
      const form=await req.formData(),file=form.get('file');
      if(!(file instanceof File)||file.size>256_000)throw new HttpError('Envie o pacote JSON de até 256 KB.',422);
      return json(await importTaxPackage(new Uint8Array(await file.arrayBuffer()),file.name,actor));
    }
    if(action==='preview'||action==='import') {
      const form=await req.formData();
      const files=form.getAll('files');
      const mapping=z.array(z.object({companyId:z.string().regex(/^0[1-6]$/),period:periodSchema,taxMode:z.enum(['confirmar','por-direcao']),emptyConfirmed:z.boolean(),replace:z.boolean()})).min(1).max(6).parse(JSON.parse(String(form.get('mapping')||'[]')));
      if(files.length!==mapping.length||files.some(f=>!(f instanceof File))) throw new HttpError('Arquivos e mapeamento não correspondem.');
      if(files.reduce((s,f)=>s+(f as File).size,0)>MAX_FILE_BYTES) throw new HttpError('Limite de 3,5 MB por lote. Divida os arquivos em lotes menores.',413);
      const items=mapping.map((m,i)=>({...m,file:files[i] as File}));
      if(action==='preview') {
        const result=[];
        for(const item of items) {
          try {const parsed=parseReport(new Uint8Array(await item.file.arrayBuffer()),{...item,importId:randomUUID(),filename:item.file.name});result.push({filename:item.file.name,rows:parsed.entries.length,warnings:parsed.warnings,encoding:parsed.encoding});}
          catch(e){result.push({filename:item.file.name,error:(e as Error).message});}
        }
        return json(result);
      }
      return json({imports:await importFiles(items,actor)});
    }
    const body=await req.json();
    if(action==='process') return json({snapshot:await processPeriod(periodSchema.parse(body.period),actor)});
    if(action==='rules') return json(await saveRule(body,actor));
    if(action==='tax-rule') return json(await saveTaxRule(body,actor));
    if(action==='period-status') return json(await setPeriodDeclaration(body,actor));
    if(action==='companies') return json(await saveCompany(body,actor));
    throw new HttpError('Rota não encontrada.',404);
  } catch(e){return fail(e);}
}
