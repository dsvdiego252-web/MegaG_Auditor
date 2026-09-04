import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMoney,parseReport,validNfeKey} from '../lib/parser';
import {audit,totals} from '../lib/audit';
import {DEFAULT_COMPANIES,type Entry,type Rule} from '../lib/types';
const header='CFOP;Valor Contábil;Base de Cálculo;Imposto Creditado;Isentas ou Não tributadas;Outras';
const options={companyId:'01',period:'2026-08',importId:'test',filename:'ApuIcms.txt',taxMode:'confirmar' as const};
const parse=(s:string)=>parseReport(new TextEncoder().encode(s),options);
const entry:Entry={id:'e1',importId:'i1',companyId:'01',period:'2026-08',line:2,raw:'source',cfop:'1102',direction:'entrada',amount:100000,base:100000,tax:12000,exempt:0,other:0,taxConfirmed:true};
const rule:Rule={id:'r1',cfop:'1102',companyId:'',uf:'',start:'2026-01',end:'',category:'tributada',operation:'compra',credit:'permitir',expectCredit:true,reason:'Condição fictícia validada apenas para teste.',reference:'Referência de teste',active:true};
const companies=DEFAULT_COMPANIES.map(c=>({...c,uf:'SP'}));
test('valores pt-BR são centavos inteiros, sem arredondamento silencioso',()=>{
 assert.equal(parseMoney('1.234.567,89'),123456789);assert.equal(parseMoney('0,01'),1);assert.equal(parseMoney('-10,01'),-1001);
 for(const invalid of ['', '1,2','1.000','123.45','1e3','NaN','1,000.00'])assert.throws(()=>parseMoney(invalid));
});
test('parser preserva texto, linha, zeros e ambiguidade de imposto em saídas',()=>{
 const r=parse(header+'\r\n1102;1.200,00;1000,00;120,00;0,00;200,00\r\n5102;2000,00;0,00;0,00;0,00;2000,00\r\n');
 assert.equal(r.entries.length,2);assert.equal(r.entries[0].line,2);assert.equal(r.entries[0].amount,120000);assert.equal(r.entries[1].taxConfirmed,false);assert.ok(r.entries[0].raw.startsWith('1102;'));
 assert.equal(totals(audit(r.entries,[],companies).entries).complete,false);
});
test('cabeçalho Windows-1252 real é reconhecido sem alteração',()=>{
 const latin=Buffer.from(header+'\n1102;100,00;100,00;12,00;0,00;0,00','latin1');
 const r=parseReport(latin,options);assert.equal(r.entries.length,1);assert.equal(r.encoding,'Windows-1252');
});
test('cabeçalho vazio é distinguido de arquivo corrompido',()=>{
 assert.equal(parse(header+'\n').entries.length,0);assert.throws(()=>parse(''));
 assert.throws(()=>parse(header+'\n1102;100,00;100,00;12,00;0,00;0,00\n5556;47700,00;0,00;0,00;0,00'),/Linha 3/);
 assert.throws(()=>parseReport(new TextEncoder().encode(header),{...options,filename:'LivroApu.txt'}),/complementares/);
});
test('sem regra ou com sobreposição é sempre Revisar',()=>{
 let r=audit([entry],[],companies);assert.equal(r.entries[0].status,'Revisar');assert.equal(r.entries[0].category,'revisar');
 r=audit([entry],[rule,{...rule,id:'r2'}],companies);assert.equal(r.entries[0].category,'revisar');assert.match(r.alerts[0].reason,/Mais de uma regra/);
});
test('regras respeitam empresa, UF, vigência e ativação',()=>{
 for(const r of [{...rule,companyId:'02'},{...rule,uf:'MG'},{...rule,start:'2026-09'},{...rule,end:'2026-07'},{...rule,active:false}])assert.equal(audit([entry],[r],companies).entries[0].ruleId,undefined);
 assert.equal(audit([entry],[rule],companies).entries[0].ruleId,'r1');
});
test('créditos indevidos e ausentes trazem explicação, sem calcular direito tributário',()=>{
 let r=audit([entry],[{...rule,credit:'vedar',expectCredit:false}],companies);assert.equal(r.alerts[0].kind,'credito-indevido');assert.match(r.alerts[0].reason,/Referência/);
 r=audit([{...entry,tax:0}],[rule],companies);assert.equal(r.alerts[0].kind,'credito-ausente');assert.equal(r.alerts[0].amount,0);assert.match(r.alerts[0].reason,/Nenhum crédito foi calculado/);
});
function key(){const first='35'+'2608'+'12345678000190'+'55'+'001'+'000000001'+'1'+'00000001';let sum=0;for(let i=42,w=2;i>=0;i--,w=w===9?2:w+1)sum+=Number(first[i])*w;const d=11-sum%11;return first+(d>=10?0:d);}
test('chaves NF-e têm 44 dígitos e verificador validado',()=>{assert.equal(validNfeKey(key()),true);assert.equal(validNfeKey('1'.repeat(44)),false);assert.equal(validNfeKey(key().slice(0,43)+'9'),key().endsWith('9'));});
test('transferência exige chave, lados opostos, empresas recíprocas e valores iguais',()=>{
 const incoming={...entry,key:key(),cfop:'1152',counterpart:'02'};
 const outgoing:Entry={...entry,id:'e2',key:key(),cfop:'5152',direction:'saida',companyId:'02',counterpart:'01'};
 const rules=[{...rule,cfop:'1152',pairedCfops:['5152'],operation:'transferencia' as const},{...rule,id:'r2',cfop:'5152',pairedCfops:['1152'],operation:'transferencia' as const}];
 const a=(rows:Entry[])=>audit(rows,rules,companies).transfers;
 assert.equal(a([incoming,outgoing])[0].status,'Conferido');
 assert.equal(a([incoming])[0].status,'Não encontrado');
 assert.equal(a([incoming,{...outgoing,amount:99}])[0].status,'Revisar');
 assert.equal(a([incoming,{...outgoing,counterpart:undefined}])[0].status,'Revisar');
 assert.equal(a([incoming,outgoing,{...outgoing,id:'e3'}])[0].status,'Revisar');
 assert.equal(a([{...incoming,key:undefined}])[0].status,'Revisar');
 assert.equal(audit([incoming],[],companies).transfers.length,1);
 assert.equal(audit([incoming],[],companies).entries[0].category,'revisar');
 assert.equal(audit([incoming,outgoing],rules.map(r=>({...r,pairedCfops:[]})),companies).transfers[0].status,'Revisar');
 assert.equal(audit([incoming,outgoing],rules,companies.map(c=>({...c,uf:c.id==='02'?'MG':'SP'}))).transfers[0].status,'Revisar');
});
test('data fora da competência e chave inválida bloqueiam importação detalhada',()=>{
 assert.throws(()=>parse(header+';Data\n1102;1,00;1,00;0,12;0,00;0,00;2026-09-01'),/fora da competência/);
 assert.throws(()=>parse(header+';Chave NF-e\n1102;1,00;1,00;0,12;0,00;0,00;123'),/Chave NF-e inválida/);
});
