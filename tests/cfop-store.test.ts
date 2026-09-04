import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {database} from '../lib/db';import {installCfopCatalog,cfopCatalog,saveAuditSettings} from '../lib/cfop-store';import {saveRule,importFiles,processPeriod,loadData} from '../lib/store';import {DEFAULT_AUDIT_SETTINGS} from '../lib/movement-audit';import {excelExport,reportExport} from '../lib/export';
test('catálogo real: instalação em lote idempotente, regras manuais preservadas e versões auditáveis',async()=>{
 process.env.LOCAL_DATABASE_PATH='.data/test-cfop-'+randomUUID();delete process.env.DATABASE_URL;process.env.ALLOW_LOCAL_DATABASE='true';process.env.DATA_ENCRYPTION_KEY='b'.repeat(64);
 const rule=await saveRule({cfop:'1102',companyId:'',uf:'',start:'2026-01',end:'',category:'tributada',operation:'compra',credit:'vedar',expectCredit:false,reason:'Exceção sintética para verificar a preservação.',reference:'Referência sintética',active:true},'tester');
 await importFiles([{file:new File(['CFOP;Valor Contábil;Base de Cálculo;Imposto Creditado;Isentas ou Não tributadas;Outras\n1102;1000,00;500,00;90,00;300,00;200,00'],'ApuIcms.txt'),companyId:'01',period:'2026-08',taxMode:'confirmar',emptyConfirmed:false,replace:false}],'tester');
 const before=await processPeriod('2026-08','tester');assert.equal(before.entries[0].category,'tributada');
 const installed=await installCfopCatalog('tester');assert.equal(installed.total,619);assert.equal(installed.changed,620);assert.equal(installed.conditional,542);assert.equal(installed.review,77);
 assert.equal((await installCfopCatalog('tester')).changed,0);const db=await database();assert.equal((await db.query('SELECT * FROM cfop_master_history')).length,620);
 assert.deepEqual((await loadData('2026-08')).rules,[rule]);assert.equal((await loadData('2026-08')).stale,true);
 const next=await processPeriod('2026-08','tester');assert.equal(next.entries[0].cfopAnalysis?.classificacao,'MISTO');assert.equal(next.entries[0].cfopAnalysis?.parts.isenta,30000);assert.equal(next.entries[0].cfopAnalysis?.regra_aplicada,rule.id);assert.ok(next.alerts.some(a=>a.kind==='credito-indevido'));assert.equal(next.reconciliations?.find(r=>r.level==='empresa')?.status,'OK');
 assert.equal((await cfopCatalog(0,'5102')).rows[0].cfop,'5102');assert.equal(next.masterRules?.length,1);
 await saveAuditSettings({...DEFAULT_AUDIT_SETTINGS,toleranceCents:2,version:1},'tester');assert.equal((await loadData('2026-08')).stale,true);await assert.rejects(()=>saveAuditSettings({...DEFAULT_AUDIT_SETTINGS,version:1},'tester'),/mudou/);
 assert.equal((await db.query<{payload:unknown}>('SELECT payload FROM mega_snapshots WHERE id=$1',[before.id]))[0].payload!==null,true);
 const data=await loadData('2026-08');assert.ok((await excelExport(data)).byteLength>1000);assert.ok(reportExport(data).includes('1102'));
 await db.close();
});
