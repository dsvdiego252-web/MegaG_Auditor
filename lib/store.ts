import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database,lock,type Connection } from './db';
import { hash,encrypt,HttpError } from './security';
import { parseReport } from './parser';
import { audit } from './audit';
import type {CfopMasterRule} from './cfop-master';
import {DEFAULT_AUDIT_SETTINGS,type AuditSettings} from './movement-audit';
import { validCnpj } from './registration';
import type {TaxRule,TaxPackage} from './tax-motor';
import type {AppData,Company,Entry,ImportRecord,Rule,Snapshot,TaxMode,PeriodDeclaration} from './types';
export const periodSchema=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const ruleSchema=z.object({
  id:z.string().max(80).optional(),cfop:z.string().regex(/^[123567]\d{3}$/),
  companyId:z.union([z.literal(''),z.string().regex(/^0[1-6]$/)]),
  uf:z.string().regex(/^$|^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/),
  start:periodSchema,end:z.union([z.literal(''),periodSchema]),
  category:z.enum(['tributada','isenta','st','outras','revisar']),operation:z.enum(['compra','venda','transferencia','outra']),
  credit:z.enum(['permitir','vedar','revisar']),debit:z.enum(['SIM','NAO','CONDICIONAL','REVISAR']).optional(),expectCredit:z.boolean(),
  pairedCfops:z.array(z.string().regex(/^[123567]\d{3}$/)).max(20).default([]),
  reason:z.string().trim().min(15).max(2000),reference:z.string().trim().min(5).max(1000),active:z.boolean()
}).refine(r=>!r.end||r.end>=r.start,{message:'Fim da vigência anterior ao início.'})
.refine(r=>!r.expectCredit||r.credit==='permitir',{message:'Crédito esperado só é compatível com permitir crédito.'});
export const companySchema=z.object({id:z.string().regex(/^0[1-6]$/),name:z.string().trim().min(2).max(80),uf:ruleSchema.shape.uf,cnpj:z.string().refine(v=>!v||validCnpj(v),{message:'CNPJ inválido.'}),legalName:z.string().trim().min(2).max(160).optional(),cnae:z.string().regex(/^$|^\d{7}$/).optional(),regime:z.string().trim().max(80).optional(),registrationSource:z.object({filename:z.string().max(200),sha256:z.string().regex(/^[a-f0-9]{64}$/),line:z.number().int().positive()}).optional()});
async function payloads<T>(db:Connection,sql:string,params:unknown[]=[]) {return (await db.query<{payload:T}>(sql,params)).map(r=>r.payload);}
export async function inputs(db:Connection,period:string) {
  const companies=await payloads<Company>(db,'SELECT payload FROM mega_companies ORDER BY id');
  const rules=await payloads<Rule>(db,'SELECT payload FROM mega_rules ORDER BY id');
  const taxRules=await payloads<TaxRule>(db,'SELECT payload FROM mega_tax_rules ORDER BY id');
  const taxPackages=await payloads<TaxPackage>(db,'SELECT payload FROM mega_tax_packages ORDER BY id');
  const records=await db.query<{payload:ImportRecord;entries:Entry[]}>('SELECT payload,entries FROM mega_imports WHERE active AND period=$1 ORDER BY company_id',[period]);
  const declarations=await payloads<PeriodDeclaration>(db,'SELECT payload FROM mega_period_declarations WHERE period=$1 ORDER BY company_id',[period]);
  const masterRules=await db.query<CfopMasterRule>('SELECT * FROM cfop_master_rules ORDER BY id');
  const [settings]=await db.query<{payload:AuditSettings;version:number}>("SELECT payload,version FROM mega_audit_settings WHERE id='icms'");
  return {companies,rules,taxRules,taxPackages,declarations,masterRules,cfopInstalled:masterRules.length>0,auditSettings:settings?.payload||DEFAULT_AUDIT_SETTINGS,auditSettingsVersion:settings?.version||1,imports:records.map(r=>r.payload),entries:records.flatMap(r=>r.entries)};
}
export function fingerprints(data:{companies:Company[];rules:Rule[];taxRules?:TaxRule[];imports:ImportRecord[];declarations?:PeriodDeclaration[];masterRules?:CfopMasterRule[];auditSettings?:AuditSettings}) {
  return {inputFingerprint:hash(JSON.stringify([data.imports.map(i=>i.id),data.declarations||[]])),ruleFingerprint:hash(JSON.stringify(['audit-v5',data.companies,data.rules,data.taxRules||[],(data.masterRules||[]).map(r=>[r.id,r.versao,r.seed_version]),data.auditSettings||DEFAULT_AUDIT_SETTINGS]))};
}
export async function loadData(period:string):Promise<AppData> {
  const db=await database();
  return db.transaction(async tx=>{
    await lock(tx);
    const data=await inputs(tx,period);
    const [snapshot]=await payloads<Snapshot>(tx,'SELECT payload FROM mega_snapshots WHERE period=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[period]);
    const periods=(await tx.query<{period:string}>('SELECT period FROM mega_imports UNION SELECT period FROM mega_period_declarations ORDER BY period DESC')).map(r=>r.period);
    const fp=fingerprints(data);
    return {demo:false,...data,snapshot:snapshot??null,periods,stale:!!snapshot&&(snapshot.inputFingerprint!==fp.inputFingerprint||snapshot.ruleFingerprint!==fp.ruleFingerprint)};
  });
}
export async function recordEvent(tx:Connection,actor:string,action:string,payload:unknown) {await tx.query('INSERT INTO mega_events(id,actor,action,payload) VALUES ($1,$2,$3,$4::jsonb)',[randomUUID(),actor,action,JSON.stringify(payload)]);}
export async function importFiles(items:{file:File;companyId:string;period:string;taxMode:TaxMode;emptyConfirmed:boolean;replace:boolean}[],actor:string) {
  if(items.length<1||items.length>6) throw new HttpError('Envie entre 1 e 6 relatórios principais por lote.');
  if(new Set(items.map(i=>i.companyId+':'+i.period)).size!==items.length) throw new HttpError('Há mais de um arquivo para a mesma empresa e competência.');
  const parsed=await Promise.all(items.map(async item=>{
    periodSchema.parse(item.period);
    const bytes=new Uint8Array(await item.file.arrayBuffer());
    const id=randomUUID();
    const result=parseReport(bytes,{...item,importId:id,filename:item.file.name});

    const record:ImportRecord={id,companyId:item.companyId,period:item.period,filename:item.file.name,hash:hash(bytes),rowCount:result.entries.length,uploadedAt:new Date().toISOString(),warnings:result.warnings,sourceKind:result.sourceKind,assessment:result.assessment,coverageWarnings:result.coverageWarnings,taxMode:item.taxMode,emptyConfirmed:item.emptyConfirmed};
    return {...item,...result,record,source:encrypt(bytes)};
  }));
  const db=await database();
  return db.transaction(async tx=>{
    await lock(tx);
    const companies=await payloads<Company>(tx,'SELECT payload FROM mega_companies');
    const results:ImportRecord[]=[];
    for(const p of parsed) {
      const selectedCompany=companies.find(c=>c.id===p.companyId);
      if(!selectedCompany) throw new HttpError('Empresa inválida.');
      if(p.sourceCnpj&&(!selectedCompany.cnpj||selectedCompany.cnpj!==p.sourceCnpj))throw new HttpError('O CNPJ do registro 0000 não corresponde ao cadastro da empresa selecionada. Confira o mapeamento.');
      if(p.sourceKind==='efd-icms')for(const e of p.entries){const counterpart=companies.find(c=>c.cnpj&&c.cnpj===e.counterpartyCnpj);if(counterpart)e.counterpart=counterpart.id;}
      const [declaration]=await payloads<PeriodDeclaration>(tx,'SELECT payload FROM mega_period_declarations WHERE company_id=$1 AND period=$2',[p.companyId,p.period]);
      if(p.entries.length&&declaration)throw new HttpError('A empresa '+p.companyId+' foi declarada sem movimento nesta competência. Reabra o movimento antes de importar valores.',409);
      if(!p.entries.length&&!p.emptyConfirmed&&!declaration)throw new HttpError(p.file.name+': confirme explicitamente a ausência de movimento.');
      if(!p.entries.length)p.record.emptyConfirmed=true;
      const existing=await payloads<ImportRecord>(tx,'SELECT payload FROM mega_imports WHERE active AND company_id=$1 AND period=$2',[p.companyId,p.period]);
      if(existing[0]?.hash===p.record.hash&&existing[0]?.taxMode===p.taxMode) {results.push(existing[0]);continue;}
      if(existing.length&&!p.replace) throw new HttpError('Já há importação para '+p.companyId+' / '+p.period+'. Marque substituir para manter o histórico e ativar a nova versão.',409);
      await tx.query('UPDATE mega_imports SET active=false WHERE company_id=$1 AND period=$2 AND active',[p.companyId,p.period]);
      await tx.query('INSERT INTO mega_imports(id,company_id,period,payload,entries,source) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6)',[p.record.id,p.companyId,p.period,JSON.stringify(p.record),JSON.stringify(p.entries),p.source]);
      await recordEvent(tx,actor,'importar',{import:p.record,previous:existing[0]?.id});
      results.push(p.record);
    }
    for (const period of new Set(parsed.map(p=>p.period))) {
      const data=await inputs(tx,period);
      for (const field of ['amount','base','tax','exempt','other'] as const) {
        const total=data.entries.reduce((sum,e)=>sum+Math.abs(e[field]),0);
        if(!Number.isSafeInteger(total)) throw new HttpError('Soma excede o limite de precisão monetária. O lote foi cancelado.');
      }
    }
    return results;
  });
}
export async function processPeriod(period:string,actor:string) {
  periodSchema.parse(period);
  const db=await database();
  return db.transaction(async tx=>{
    await lock(tx);
    const data=await inputs(tx,period);
    if(!data.imports.length&&!data.declarations.length) throw new HttpError('Importe os relatórios ou declare as empresas sem movimento antes de processar.');
    const result=audit(data.entries,data.rules,data.companies,data.taxRules,{masterRules:data.masterRules,settings:data.auditSettings,imports:data.imports});
    for(const c of data.companies) if(!data.imports.some(i=>i.companyId===c.id)&&!data.declarations.some(d=>d.companyId===c.id)) result.alerts.unshift({id:'missing:'+c.id,companyId:c.id,priority:'alta',kind:'cobertura',title:'Empresa sem relatório',reason:c.name+': competência incompleta. Importe o relatório ou arquivo sem movimento confirmado.'});
    const snapshot:Snapshot={id:randomUUID(),period,processedAt:new Date().toISOString(),...result,masterRules:data.masterRules.filter(r=>data.entries.some(e=>e.cfop===r.cfop)),auditSettings:data.auditSettings,rules:data.rules,taxRules:data.taxRules,taxPackages:data.taxPackages,imports:data.imports,companies:data.companies,declarations:data.declarations,...fingerprints(data)};
    if(Buffer.byteLength(JSON.stringify(snapshot),'utf8')>3_500_000) throw new HttpError('O resultado excede o limite desta versão. Utilize os relatórios resumidos por CFOP; grandes volumes detalhados exigem processamento em fila e paginação.',413);
    await tx.query('INSERT INTO mega_snapshots(id,period,payload) VALUES ($1,$2,$3::jsonb)',[snapshot.id,period,JSON.stringify(snapshot)]);
    await recordEvent(tx,actor,'processar',{snapshotId:snapshot.id,period,imports:data.imports.map(i=>i.id),alerts:result.alerts.length});
    return snapshot;
  });
}
export async function saveRule(input:unknown,actor:string) {
  const parsed=ruleSchema.parse(input);
  const rule:Rule={...parsed,id:parsed.id||randomUUID()};
  const db=await database();
  return db.transaction(async tx=>{
    await lock(tx);
    const previous=await payloads<Rule>(tx,'SELECT payload FROM mega_rules WHERE id=$1',[rule.id]);
    await tx.query('INSERT INTO mega_rules(id,payload) VALUES ($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',[rule.id,JSON.stringify(rule)]);
    await recordEvent(tx,actor,'salvar-regra',{before:previous[0],after:rule});
    return rule;
  });
}
export async function saveCompany(input:unknown,actor:string) {
  const parsed=companySchema.parse(input);
  const db=await database();
  return db.transaction(async tx=>{
    await lock(tx);
    const [previous]=await payloads<Company>(tx,'SELECT payload FROM mega_companies WHERE id=$1',[parsed.id]);
    if(!previous) throw new HttpError('Empresa não encontrada.',404);
    const company:Company={...previous,...parsed,uf:parsed.uf||null,cnpj:parsed.cnpj||null};
    if(!parsed.registrationSource&&(company.cnpj!==previous.cnpj||company.uf!==previous.uf||company.legalName!==previous.legalName))delete company.registrationSource;
    await tx.query('UPDATE mega_companies SET payload=$2::jsonb WHERE id=$1',[parsed.id,JSON.stringify(company)]);
    await recordEvent(tx,actor,'salvar-empresa',{before:previous,after:company});
    return company;
  });
}

export async function setPeriodDeclaration(input:unknown,actor:string){
  const value=z.object({companyId:z.string().regex(/^0[1-6]$/),period:periodSchema,noMovement:z.boolean(),reason:z.string().trim().min(10).max(1000)}).parse(input);
  const db=await database();
  return db.transaction(async tx=>{
    await lock(tx);
    const company=await tx.query('SELECT id FROM mega_companies WHERE id=$1',[value.companyId]);
    if(!company.length)throw new HttpError('Empresa não encontrada.',404);
    const [before]=await payloads<PeriodDeclaration>(tx,'SELECT payload FROM mega_period_declarations WHERE company_id=$1 AND period=$2',[value.companyId,value.period]);
    if(value.noMovement){
      const active=await payloads<ImportRecord>(tx,'SELECT payload FROM mega_imports WHERE active AND company_id=$1 AND period=$2',[value.companyId,value.period]);
      if(active.some(i=>i.rowCount>0))throw new HttpError('Há lançamentos importados. Não é possível declarar ausência de movimento.',409);
      const declaration:PeriodDeclaration={...value,noMovement:true,declaredBy:actor,declaredAt:new Date().toISOString()};
      await tx.query('INSERT INTO mega_period_declarations(company_id,period,payload) VALUES ($1,$2,$3::jsonb) ON CONFLICT(company_id,period) DO UPDATE SET payload=excluded.payload',[value.companyId,value.period,JSON.stringify(declaration)]);
      await recordEvent(tx,actor,'declarar-sem-movimento',{before,after:declaration});
      return declaration;
    }
    await tx.query('DELETE FROM mega_period_declarations WHERE company_id=$1 AND period=$2',[value.companyId,value.period]);
    await recordEvent(tx,actor,'reabrir-movimento',{before,...value});
    return {ok:true};
  });
}
