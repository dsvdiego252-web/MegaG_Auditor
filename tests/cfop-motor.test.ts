import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCfopSeed,catalogStats,masterFor,resolveManual} from '../lib/cfop-master';
import {analyzeMovement,DEFAULT_AUDIT_SETTINGS,hierarchyReconciliation,reconcile,auditSettingsSchema} from '../lib/movement-audit';
import type {Entry,Company,Rule} from '../lib/types';
const masters=buildCfopSeed();
const company:Company={id:'01',name:'Empresa fictícia',head:true,uf:'SP',cnpj:null};
function entry(cfop='5102',change:Partial<Entry>={}):Entry{return {id:'x:2',importId:'x',companyId:'01',period:'2026-08',line:2,raw:'dados fictícios',cfop,direction:+cfop[0]<4?'entrada':'saida',amount:100000,base:100000,tax:18000,exempt:0,other:0,taxConfirmed:true,granularity:'agregado',sourceKind:'consinco',...change};}
const evaluate=(e:Entry,rules:Rule[]=[])=>analyzeMovement(e,company,masters,rules);
const rule=(change:Partial<Rule>={}):Rule=>({id:'manual',cfop:'5102',companyId:'',uf:'',start:'2026-01',end:'',category:'revisar',operation:'venda',credit:'revisar',expectCredit:false,reference:'Teste sintético sem valor fiscal',reason:'Exceção fictícia de teste',active:true,...change});

test('catálogo completo mantém 619 códigos, cabeçalhos fora do seed e vigência histórica',()=>{
 const stats=catalogStats(masters);assert.equal(stats.total,619);assert.equal(stats.versions,620);assert.equal(Object.values(stats.byGroup).reduce((a,b)=>a+b,0),619);assert.equal(stats.conditional+stats.review,619);
 assert.equal(masters.some(m=>m.cfop==='1000'||m.cfop==='1100'),false);assert.ok(masters.some(m=>m.cfop==='1120'));
 assert.match(masterFor(entry('7667',{period:'2026-01'}),masters)!.descricao_oficial,/Venda/);assert.match(masterFor(entry('7667',{period:'2026-02'}),masters)!.descricao_oficial,/Saída/);
 assert.equal(masterFor(entry('5102',{period:'2023-08'}),masters),undefined);
});
test('natureza, compras e vendas são automáticas, com crédito/débito condicionais',()=>{
 for(const code of ['1101','2101','1102','2102','1401','2401','1403','2403']){const a=evaluate(entry(code));assert.equal(a.impacta_compras,'SIM',code);assert.equal(a.credito_icms,'CONDICIONAL',code);}
 for(const code of ['5101','6101','5102','6102','5401','6401','5405','6404']){const a=evaluate(entry(code));assert.equal(a.impacta_faturamento,'SIM',code);assert.equal(a.debito_icms,'CONDICIONAL',code);}
});
test('transferências, devoluções, remessas, retornos, ativo e baixas não viram faturamento',()=>{
 for(const code of ['1151','2152','5151','6152','5409','1552','5552']){const a=evaluate(entry(code));assert.equal(a.grupo,'TRANSFERENCIA',code);assert.equal(a.impacta_faturamento,'NAO');assert.equal(a.impacta_compras,'NAO');}
 for(const [code,group] of [['1202','DEVOLUCAO'],['5202','DEVOLUCAO'],['5901','REMESSA'],['5902','RETORNO'],['1551','ATIVO_IMOBILIZADO'],['1556','USO_CONSUMO'],['5927','PERDA_BAIXA']])assert.equal(evaluate(entry(code)).grupo,group,code);
 for(const code of ['1202','5202','5901','5902','5551','5927'])assert.equal(evaluate(entry(code)).impacta_faturamento,'NAO',code);
});
test('5102 tributado e 5102 isento são separados sem regra manual',()=>{
 assert.equal(evaluate(entry()).classificacao,'TRIBUTADO');
 const a=evaluate(entry('5102',{base:0,tax:0,exempt:100000}));assert.equal(a.classificacao,'ISENTO_NAO_TRIBUTADO');assert.equal(a.parts.tributada,0);assert.equal(a.parts.isenta,100000);
 const mixed=evaluate(entry('5102',{base:50000,tax:9000,exempt:30000,other:20000}));assert.equal(mixed.classificacao,'MISTO');assert.deepEqual(mixed.parts,{tributada:50000,isenta:30000,st:0,outras:20000,revisar:0});assert.equal(mixed.reconciliation.status,'OK');
});
test('redução de base e parcelas explícitas não são completadas artificialmente',()=>{
 const a=evaluate(entry('5102',{base:80000}));assert.equal(a.parts.tributada,80000);assert.equal(a.reconciliation.difference,20000);assert.equal(a.reconciliation.status,'CRITICO');
 const reduced=evaluate(entry('5102',{base:80000,granularity:'c190',sourceKind:'efd-icms',fiscal:{cstIcms:'020'}}));assert.equal(reduced.parts.tributada,100000);assert.equal(reduced.reconciliation.difference,0);
 const supplied=evaluate(entry('5102',{base:80000,reportedParts:{tributada:75000}}));assert.equal(supplied.parts.tributada,75000);assert.equal(supplied.parts.revisar,25000);
});
test('ST precisa de situação, regra, cadeia e evidência; bases não são somadas ao valor da operação',()=>{
 const incomplete=evaluate(entry('5405',{base:0,tax:0,other:100000,fiscal:{cstIcms:'060'}}));assert.equal(incomplete.parts.st,0);assert.ok(incomplete.findings.some(f=>f.kind==='st-condicional'));
 const st=evaluate(entry('5405',{base:0,tax:0,other:100000,fiscal:{cstIcms:'060',cest:'0000000',chainPosition:'substituido'}}));assert.equal(st.parts.st,100000);assert.equal(st.parts.outras,0);assert.equal(st.classificacao,'SUBSTITUICAO_TRIBUTARIA');
 const both=evaluate(entry('5401',{stBase:150000,stTax:9000,fiscal:{cstIcms:'010',cest:'0000000',chainPosition:'substituto'}}));assert.equal(both.parts.st,100000);assert.equal(both.parts.tributada,0);assert.equal(both.reconciliation.difference,0);
 assert.ok(evaluate(entry('1102',{stTax:100})).findings.some(f=>f.kind==='st-nao-confirmada'));
});
test('reconciliação mantém diferenças, limita tolerância e impede cancelamento entre linhas',()=>{
 assert.equal(reconcile(100000,99999,DEFAULT_AUDIT_SETTINGS).status,'OK');assert.equal(reconcile(100,99,DEFAULT_AUDIT_SETTINGS).status,'CRITICO');
 assert.equal(auditSettingsSchema.safeParse({...DEFAULT_AUDIT_SETTINGS,toleranceCents:10000}).success,false);
 const a=entry('5102',{id:'a',base:90000}),b=entry('5102',{id:'b',base:110000});
 const results=hierarchyReconciliation([a,b].map(e=>({...e,cfopAnalysis:evaluate(e)})),DEFAULT_AUDIT_SETTINGS);
 const total=results.find(r=>r.level==='competencia')!;assert.equal(total.difference,0);assert.equal(total.absoluteDifference,20000);assert.equal(total.status,'CRITICO');assert.equal(results.filter(r=>r.level==='registro').length,2);
});
test('prioridade manual preserva exceções; empate e conflito de natureza exigem revisão',()=>{
 const general=rule(),uf=rule({id:'uf',uf:'SP'}),companyRule=rule({id:'company',companyId:'01'}),specific=rule({id:'specific',companyId:'01',uf:'SP'});
 assert.equal(resolveManual(entry(),company,[general,uf,companyRule,specific]).rule!.id,'specific');assert.equal(resolveManual(entry(),company,[general,uf,companyRule]).rule!.id,'company');
 assert.equal(resolveManual(entry(),company,[general,uf]).rule!.id,'uf');assert.equal(resolveManual(entry(),company,[general,rule({id:'same'})]).conflict,true);
 const a=evaluate(entry('5152'),[rule({cfop:'5152'})]);assert.equal(a.manualRuleId,'manual');assert.equal(a.impacta_faturamento,'CONDICIONAL');assert.ok(a.findings.some(f=>f.kind==='natureza'));
});
test('alertas verificam direção, UF, CST, base e imposto, sem calcular créditos',()=>{
 assert.ok(evaluate(entry('1102',{directionDeclared:'saida'})).findings.some(f=>f.kind==='cfop-movimento'));
 assert.ok(evaluate(entry('1102',{fiscal:{ufOrigem:'MG',ufDestino:'SP'}})).findings.some(f=>f.kind==='cfop-uf'));
 assert.ok(evaluate(entry('2102',{fiscal:{ufOrigem:'SP',ufDestino:'SP'}})).findings.some(f=>f.kind==='cfop-uf'));
 assert.ok(evaluate(entry('1102',{tax:0})).findings.some(f=>f.kind==='credito-ausente'));
 assert.ok(evaluate(entry('5102',{tax:0})).findings.some(f=>f.kind==='debito-ausente'));
 assert.ok(evaluate(entry('1102',{fiscal:{cstIcms:'040'}})).findings.some(f=>f.kind==='credito-indevido'));
 assert.ok(evaluate(entry('5102',{base:0})).findings.some(f=>f.kind==='icms-sem-base'));
 assert.ok(evaluate(entry('1998')).findings.some(f=>f.kind==='cfop-oficial'));
});
