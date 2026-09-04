import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from '../lib/db';
import {importTaxPackage,saveTaxRule} from '../lib/tax-store';
import {loadData,importFiles,processPeriod} from '../lib/store';
import {decrypt,hash} from '../lib/security';
import {excelExport,reportExport} from '../lib/export';
import type {TaxRule,TaxRuleInput} from '../lib/tax-motor';
const source=Buffer.from(JSON.stringify({meta:{nome:'Motor sintético',versao:'0.0.1'},icms_sp:{regras_gerais:[{id:'TST_RATE',referencia:'Fundamento fictício',aliquota_referencia_percentual:12}]},casos_validados_historicos:[],secao_extra:{texto:'Também preservar esta seção'}}));
function input(r:TaxRule):TaxRuleInput{const {id,version,title,domain,status,start,end,reference,reason,conditions,requiredFields,checks}=r;return {id,version,title,domain,status,start,end,reference,reason,conditions,requiredFields,checks};}

test('pacote idempotente, original criptografado, versões imutáveis, reprocessamento e exportação',async()=>{
 process.env.LOCAL_DATABASE_PATH='.data/test-motor-'+randomUUID();delete process.env.DATABASE_URL;process.env.ALLOW_LOCAL_DATABASE='true';process.env.DATA_ENCRYPTION_KEY='b'.repeat(64);
 const db=await database();
 try{
  const imported=await importTaxPackage(source,'motor.json','teste');assert.equal(imported.duplicate,false);assert.equal(imported.package.ruleCount,1);
  const original=await db.query<{source:string}>('SELECT source FROM mega_tax_packages WHERE id=$1',[imported.package.id]);
  assert.notEqual(original[0].source,source.toString());assert.deepEqual(decrypt(original[0].source),source);assert.equal(hash(source),imported.package.hash);
  const dup=await importTaxPackage(source,'renomeado.json','teste');assert.equal(dup.duplicate,true);assert.equal(dup.package.id,imported.package.id);
  const data=await loadData('2026-08');assert.equal(data.taxRules?.length,1);const seed=data.taxRules![0];assert.equal(seed.status,'pendente');assert.deepEqual(seed.checks,[]);
  const header='CFOP;Valor Contábil;Base de Cálculo;Imposto Creditado;Isentas ou Não tributadas;Outras;Alíquota ICMS';
  await importFiles([{file:new File([header+'\n1102;1000,00;1000,00;180,00;0,00;0,00;18,00'],'teste.csv'),companyId:'01',period:'2026-08',taxMode:'confirmar',emptyConfirmed:false,replace:false}],'teste');
  const first=await processPeriod('2026-08','teste');assert.equal(first.taxRules?.[0].version,1);assert.equal(first.entries[0].taxFindings,undefined);assert.ok(first.alerts.some(a=>a.id==='motor:pendentes'));
  await assert.rejects(()=>saveTaxRule({...input(seed),status:'validada'},'teste'));
  const configured:TaxRuleInput={...input(seed),status:'validada',start:'2026-01-01',reference:'Referência fictícia de teste',reason:'Critério sintético, sem valor fiscal.',conditions:[{field:'cfop',operator:'in',values:['1102']}],checks:[{field:'icmsRate',operator:'equals',values:['12'],severity:'alta',message:'Alíquota diverge da regra sintética de teste.'}]};
  const saved=await saveTaxRule(configured,'responsavel-teste');assert.equal(saved.version,2);assert.equal(saved.validatedBy,'responsavel-teste');assert.deepEqual(saved.source,seed.source);
  await assert.rejects(()=>saveTaxRule(configured,'teste'),/outra sessão/);
  const after=await loadData('2026-08');assert.equal(after.stale,true);assert.equal(after.snapshot?.taxRules?.[0].status,'pendente');
  const second=await processPeriod('2026-08','teste');assert.equal(second.entries[0].taxFindings?.[0].status,'DIVERGENTE');assert.equal(second.entries[0].taxFindings?.[0].version,2);assert.equal(second.entries[0].tax,18000);
  assert.equal((await loadData('2026-08')).stale,false);
  await saveTaxRule({...input(saved),status:'inativa'},'teste');
  assert.equal((await loadData('2026-08')).stale,true);assert.equal((await loadData('2026-08')).snapshot?.taxRules?.[0].status,'validada');
  const versions=await db.query<{version:number;payload:TaxRule}>('SELECT version,payload FROM mega_tax_revisions WHERE rule_id=$1 ORDER BY version',[seed.id]);assert.deepEqual(versions.map(v=>v.version),[1,2,3]);assert.equal(versions[0].payload.status,'pendente');
  assert.equal((await importTaxPackage(source,'motor.json','teste')).duplicate,true);assert.equal((await loadData('2026-08')).taxRules?.[0].status,'inativa');
  const fresh=await loadData('2026-08');const {default:ExcelJS}=await import('exceljs');const book=new ExcelJS.Workbook();await book.xlsx.load(await excelExport(fresh));
  assert.equal(book.getWorksheet('Motor - evidências')?.getRow(2).getCell(5).value,2);assert.equal(book.getWorksheet('Motor - evidências')?.getRow(2).getCell(6).value,'DIVERGENTE');assert.ok(reportExport(fresh).includes('Alíquota diverge da regra sintética'));
  const {GET,POST}=await import('../app/api/[action]/route');
  const context={params:Promise.resolve({action:'tax-source'})};
  const anonymous=await GET(new Request('https://example.test/api/tax-source?id='+imported.package.id),context);assert.equal(anonymous.status,401);
  const demo=await GET(new Request('https://example.test/api/tax-source?mode=demo&id='+imported.package.id),context);assert.equal(demo.status,401);
  process.env.APP_ORIGIN='https://example.test';
  const unauthorized=await POST(new Request('https://example.test/api/tax-rule',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:JSON.stringify(configured)}),{params:Promise.resolve({action:'tax-rule'})});assert.equal(unauthorized.status,401);
 }finally{await db.close();}
});
