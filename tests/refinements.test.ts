import test from 'node:test';
import assert from 'node:assert/strict';
import {parseReport} from '../lib/parser';
import {parseEstablishments,validCnpj} from '../lib/registration';
import {audit,totals} from '../lib/audit';
import {DEFAULT_COMPANIES} from '../lib/types';
const base='CFOP;Valor Contábil;Base de Cálculo;Imposto Creditado;Isentas ou Não tributadas;Outras';
const options={companyId:'01',period:'2026-08',importId:'test',filename:'ApuIcms.txt',taxMode:'confirmar' as const};
const parse=(s:string)=>parseReport(Buffer.from(s),options);
test('cabeçalhos distintos de entrada e saída determinam crédito e débito sem confirmação manual',()=>{
 const debit=base.replace('Creditado','Debitado');
 const text=base+'\n1102;1000,00;1000,00;120,00;0,00;0,00\n'+debit+'\n5102;2000,00;2000,00;240,00;0,00;0,00';
 const r=parse(text);assert.equal(r.entries.length,2);assert.equal(r.entries[1].line,4);assert.equal(r.entries[1].taxLabel,'Imposto Debitado');assert.equal(r.entries[1].taxMapping,'cabecalho');
 const t=totals(audit(r.entries,[],DEFAULT_COMPANIES).entries);assert.equal(t.credit,12000);assert.equal(t.debit,24000);assert.equal(t.balance,12000);assert.equal(t.complete,true);
});
test('duas colunas de imposto são respeitadas e valores na coluna oposta não são omitidos',()=>{
 const header=base.replace('Imposto Creditado','Imposto Creditado;Imposto Debitado');
 const r=parse(header+'\n1102;100,00;100,00;12,00;0,00;0,00;0,00\n5102;100,00;100,00;0,00;12,00;0,00;0,00');
 assert.deepEqual(r.entries.map(e=>e.tax),[1200,1200]);assert.ok(r.entries.every(e=>e.taxConfirmed));
 assert.throws(()=>parse(header+'\n5102;100,00;100,00;12,00;12,00;0,00;0,00'),/coluna oposta/);
});
test('imposto de entrada com rótulo incompatível não entra no crédito até confirmação',()=>{
 const text=base.replace('Creditado','Debitado')+'\n1102;100,00;100,00;12,00;0,00;0,00';
 assert.equal(totals(audit(parse(text).entries,[],DEFAULT_COMPANIES).entries).credit,0);
 const r=parseReport(Buffer.from(text),{...options,taxMode:'por-direcao'});assert.equal(r.entries[0].taxMapping,'confirmacao');assert.equal(totals(audit(r.entries,[],DEFAULT_COMPANIES).entries).credit,1200);
});
function fakeCnpj(base:string){let result=base;for(let size=12;size<=13;size++){let sum=0;for(let i=0,w=size-7;i<size;i++,w=w===2?9:w-1)sum+=Number(result[i])*w;result+=sum%11<2?'0':String(11-sum%11);}return result;}
test('0140 usa campos oficiais, não inventa empresa ausente e rejeita conflito',()=>{
 const cnpj=fakeCnpj('987654320001');assert.ok(validCnpj(cnpj));assert.equal(validCnpj('00000000000000'),false);
 const row='|0140|3|EMPRESA FICTICIA|'+cnpj+'|MG|123|3106200|||';
 const r=parseEstablishments(Buffer.from('|0000|EXEMPLO|\n'+row));assert.equal(r.length,1);assert.equal(r[0].id,'03');assert.equal(r[0].uf,'MG');assert.equal(r[0].legalName,'EMPRESA FICTICIA');assert.equal(r[0].line,2);assert.ok(!r.some(c=>c.id==='04'));
 assert.throws(()=>parseEstablishments(Buffer.from(row+'\n'+row.replace('FICTICIA','DIVERGENTE'))),/conflitantes/);
});
test('catálogo identifica transferências sem atribuir permissão de crédito ou categoria fiscal',()=>{
 const r=audit(parse(base+'\n1152;100,00;100,00;12,00;0,00;0,00').entries,[],DEFAULT_COMPANIES);
 assert.equal(r.transferCfops.length,1);assert.equal(r.transferCfops[0].cfop,'1152');assert.equal(r.transferCfops[0].status,'Revisar');assert.equal(r.entries[0].category,'revisar');assert.equal(r.entries[0].ruleId,undefined);assert.ok(r.transferCfops[0].reasons.some(r=>r.includes('Nenhuma regra')));
});
