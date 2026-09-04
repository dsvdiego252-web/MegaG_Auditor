import test from 'node:test';import assert from 'node:assert/strict';
import {parseReport} from '../lib/parser';import {buildCfopSeed} from '../lib/cfop-master';import {audit,totals} from '../lib/audit';import {DEFAULT_AUDIT_SETTINGS} from '../lib/movement-audit';
const opts={companyId:'01',period:'2026-08',importId:'test',taxMode:'confirmar' as const,filename:'efd.txt'};
function line(reg:string,values:Record<number,string>={},length=1){const v=Array(Math.max(length,...Object.keys(values).map(Number))+1).fill('');v[1]=reg;for(const [i,x] of Object.entries(values))v[Number(i)]=x;return v.join('|')+'|';}
const head=line('0000',{2:'020',3:'0',4:'01082026',5:'31082026',6:'Empresa fictícia',7:'12345678000195',9:'SP'},15);
const doc=line('C100',{2:'1',3:'0',5:'01',6:'00',7:'1',8:'123',10:'10082026',11:'10082026',12:'1000,00',21:'600,00',22:'108,00'},29);
const item=(n:string,cst:string,value:string,base:string,tax:string,aliq:string)=>line('C170',{2:n,3:'P'+n,7:value,8:'0',10:cst,11:'5102',13:base,14:aliq,15:tax,16:'0',18:'0'},37);
const analytic=(cst:string,value:string,base:string,tax:string,aliq:string)=>line('C190',{2:cst,3:'5102',4:aliq,5:value,6:base,7:tax,8:'0',9:'0',10:'0',11:'0'},12);
const records=[head,doc,item('1','000','600','600','108','18'),item('2','040','400','0','0','0'),analytic('000','600','600','108','18'),analytic('040','400','0','0','0'),line('E100',{2:'01082026',3:'31082026'}),line('E110',{2:'108',6:'0'},15),line('9999',{2:'9'})];
const parse=(rows=records)=>parseReport(new TextEncoder().encode(rows.join('\n')),opts);
test('EFD mantém C190 por CST e alíquota, itens ligados e sem duplicação nos totais',()=>{
 const parsed=parse();assert.equal(parsed.entries.length,2);assert.equal(parsed.entries[0].items?.length,1);assert.equal(parsed.assessment?.debit,10800);assert.equal(parsed.sourceCnpj,'12345678000195');
 const result=audit(parsed.entries,[],[{id:'01',name:'Fictícia',head:true,uf:'SP',cnpj:null}],[],{masterRules:buildCfopSeed(),settings:DEFAULT_AUDIT_SETTINGS,imports:[{...opts,id:'test',filename:'efd.txt',hash:'synthetic',uploadedAt:'',rowCount:2,warnings:[],taxMode:'confirmar',emptyConfirmed:false,assessment:parsed.assessment}]});
 assert.equal(totals(result.entries).sales,100000);assert.equal(result.entries[0].cfopAnalysis?.parts.tributada,60000);assert.equal(result.entries[1].cfopAnalysis?.parts.isenta,40000);
 assert.equal(result.reconciliations?.filter(r=>r.id.includes(':E110:')).every(r=>r.status==='OK'),true);
 assert.equal(result.reconciliations?.filter(r=>r.id.includes(':C100:')).every(r=>r.status==='OK'),true);
 assert.equal(result.reconciliations?.filter(r=>r.level==='cfop_cst_aliquota').length,2);
 assert.equal(parsed.entries[0].raw,records[4]);assert.equal(parsed.entries[0].documentSource?.raw,doc);
});
test('EFD rejeita documentos/itens sem analítico e duplicatas, não omite linhas silenciosamente',()=>{
 assert.throws(()=>parse(records.filter(r=>r!==records[5])),/sem C190 correspondente/);
 assert.throws(()=>parse([...records.slice(0,6),records[4],...records.slice(6)]),/C190 duplicado/);
 assert.throws(()=>parse(records.filter(r=>!r.startsWith('|C190|'))),/sem C190/);
 assert.throws(()=>parse(records.slice(0,-1)),/9999/);
 assert.throws(()=>parse(records.map(r=>r.replace('|020|','|021|'))),/não suportado/);
 assert.throws(()=>parse([head,'|0110|1|',...records.slice(1)]),/Contribuições/);
 assert.throws(()=>parseReport(new TextEncoder().encode(records.join('\n')),{...opts,period:'2026-07'}),/competência/);
});
test('diferenças C100 e cobertura parcial da EFD ficam explícitas; CST não é colapsado',()=>{
 const p=parse(records.map(r=>r===doc?r.replace('1000,00','1001,00'):r));const a=audit(p.entries,[],[],[],{masterRules:buildCfopSeed(),settings:DEFAULT_AUDIT_SETTINGS});
 assert.equal(a.reconciliations?.find(r=>r.id.includes(':C100:amount'))?.difference,100);assert.ok(a.alerts.some(a=>a.kind==='reconciliacao-documento'));
 const partial=parse([...records.slice(0,-1),'|D100|',records.at(-1)!]);assert.ok(partial.coverageWarnings?.some(x=>x.includes('D100')));
 const blank=parse(['',...records]);assert.equal(blank.entries[0].line,6);
});
test('Consinco aceita parcelas explícitas e contexto ST, preservando o registro integral',()=>{
 const header='CFOP;Valor Contábil;Base de Cálculo;Imposto Creditado;Isentas ou Não tributadas;Outras;ValorTributado;ValorST;BaseICMSST;ValorICMSST;PosicaoCadeia;TipoMovimento;CSTICMS;CEST';
 const original='1403;1000,00;0,00;0,00;0,00;0,00;0,00;1000,00;0,00;0,00;substituido;entrada;060;1234567';
 const e=parseReport(new TextEncoder().encode(header+'\n'+original),{...opts,filename:'ApuIcms.txt'}).entries[0];assert.equal(e.raw,original);assert.equal(e.reportedParts?.st,100000);assert.equal(e.fiscal?.chainPosition,'substituido');
 const result=audit([e],[],[],[],{masterRules:buildCfopSeed(),settings:DEFAULT_AUDIT_SETTINGS});assert.equal(result.entries[0].cfopAnalysis?.parts.st,100000);
 const pending=audit([{...e,fiscal:{cstIcms:'060'}}],[],[],[],{masterRules:buildCfopSeed(),settings:DEFAULT_AUDIT_SETTINGS});assert.equal(pending.entries[0].cfopAnalysis?.parts.st,0);assert.equal(pending.entries[0].cfopAnalysis?.parts.revisar,100000);
});
