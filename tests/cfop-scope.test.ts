import test from 'node:test';
import assert from 'node:assert/strict';
import {audit} from '../lib/audit';
import {cfopScope} from '../lib/cfop';
import {DEFAULT_COMPANIES,type Entry,type Rule} from '../lib/types';
const entry:Entry={id:'e1',importId:'i1',companyId:'01',period:'2026-08',line:2,raw:'origem fictícia',cfop:'1152',direction:'entrada',amount:10000,base:0,tax:0,exempt:0,other:10000,taxConfirmed:true};
const rule:Rule={id:'r1',cfop:'1152',companyId:'',uf:'',start:'2026-01',end:'',category:'outras',operation:'transferencia',credit:'vedar',expectCredit:false,reason:'Critério fictício exclusivo do teste.',reference:'Referência de teste, sem valor fiscal',active:true};
test('abrangência vem do CFOP mesmo sem contraparte; pendência documental não é divergência',()=>{
 for(const [cfop,scope,direction] of [['1152','interna','entrada'],['2152','interestadual','entrada'],['5152','interna','saida'],['6152','interestadual','saida']] as const){
  const r=audit([{...entry,cfop,direction}],[{...rule,cfop}],DEFAULT_COMPANIES);
  assert.equal(cfopScope(cfop)?.scope,scope);
  assert.equal(r.entries[0].status,'Conferido');assert.equal(r.entries[0].ufCheck?.status,'Pendente');
  assert.equal(r.alerts.some(a=>a.kind==='transferencia-uf'),false);
  assert.equal(r.transferCfops[0].status,'Conferido');assert.equal(r.transferCfops[0].ufCheck?.status,'Pendente');
  assert.equal(r.transfers[0].status,'Revisar');assert.match(r.transfers[0].reason,/sem chave/);
 }
 assert.equal(cfopScope('3102')?.scope,'exterior');assert.equal(cfopScope('7102')?.scope,'exterior');assert.equal(cfopScope('invalid'),undefined);
});
test('UFs contraditórias geram alerta mesmo quando o CFOP identifica a abrangência',()=>{
 const companies=DEFAULT_COMPANIES.map(c=>({...c,uf:c.id==='02'?'MG':'SP'}));
 const r=audit([{...entry,counterpart:'02'}],[rule],companies);
 assert.equal(r.entries[0].ufCheck?.status,'Divergente');assert.equal(r.entries[0].status,'Revisar');assert.ok(r.alerts.some(a=>a.kind==='transferencia-uf'));
 const valid=audit([{...entry,cfop:'2152',counterpart:'02'}],[{...rule,cfop:'2152'}],companies);
 assert.equal(valid.entries[0].ufCheck?.status,'Conferido');assert.equal(valid.entries[0].status,'Conferido');
});
test('a classificação pelo CFOP não supre regra fiscal nem permite conferir NF-e com UFs pendentes',()=>{
 const noRule=audit([entry],[],DEFAULT_COMPANIES);assert.equal(noRule.entries[0].category,'revisar');assert.equal(noRule.entries[0].status,'Revisar');
 const pair=audit([{...entry,key:'chave-sintetica',counterpart:'02'},{...entry,id:'e2',companyId:'02',direction:'saida',cfop:'5152',key:'chave-sintetica',counterpart:'01'}],[{...rule,pairedCfops:['5152']},{...rule,id:'r2',cfop:'5152',pairedCfops:['1152']}],DEFAULT_COMPANIES);
 assert.equal(pair.transfers[0].status,'Revisar');assert.match(pair.transfers[0].reason,/conferência das UFs/);
});
