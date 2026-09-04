import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {evaluateTaxRules,taxRuleInput,type TaxRule} from '../lib/tax-motor';
import {parseReport} from '../lib/parser';
import {parseTaxPackage} from '../lib/tax-package';
import {audit} from '../lib/audit';
import type {Entry,Company} from '../lib/types';
const company:Company={id:'01',name:'Empresa fictícia',uf:'SP',cnpj:null,head:true};
const entry:Entry={id:'i:2',importId:'i',companyId:'01',period:'2026-08',line:2,raw:'origem fictícia',cfop:'1102',direction:'entrada',amount:100000,base:100000,tax:12000,exempt:0,other:0,taxConfirmed:true};
const rule=(extra:Partial<TaxRule>={}):TaxRule=>({id:randomUUID(),version:1,title:'Critério sintético de teste',domain:'ICMS',status:'validada',start:'2026-01-01',end:'',reference:'Referência fictícia de teste',reason:'Critério sintético, sem valor fiscal.',conditions:[{field:'cfop',operator:'in',values:['1102']}],requiredFields:[],checks:[{field:'icmsRate',operator:'equals',values:['12'],severity:'alta',message:'Conferir alíquota do exemplo sintético.'}],packageId:'package-test',sourcePath:'teste.0',source:{ficticio:true},updatedAt:'2026-01-01T00:00:00Z',updatedBy:'teste',...extra});
const detailed={...entry,fiscal:{icmsRate:12,ncm:'00000000',productDescription:'Produto fictício sem açúcar'}};
function input(r:TaxRule){const {packageId,sourcePath,source,updatedAt,updatedBy,...v}=r;return v;}

test('referências pendentes, inativas e futuras não viram regras executáveis',()=>{
 for(const r of [rule({status:'pendente'}),rule({status:'inativa'}),rule({start:'2027-01-01'}),rule({end:'2026-07-31'}),rule({domain:'PIS/COFINS'})])assert.deepEqual(evaluateTaxRules(detailed,company,[r]),[]);
 assert.equal(taxRuleInput.safeParse(input(rule({conditions:[],start:''}))).success,false);
 assert.equal(taxRuleInput.safeParse(input(rule({domain:'PIS/COFINS'}))).success,false);
 assert.equal(taxRuleInput.safeParse(input(rule({conditions:[{field:'uf',operator:'in',values:['SP']}]}))).success,false);
});
test('não infere alíquota; registra ausência e preserva valores originais',()=>{
 const [missing]=evaluateTaxRules(entry,company,[rule()]);
 assert.equal(missing.status,'REVISAR');assert.deepEqual(missing.missing,['icmsRate']);assert.equal(missing.evidence.icmsRate,undefined);
 const [ok]=evaluateTaxRules(detailed,company,[rule()]);assert.equal(ok.status,'OK');assert.equal(ok.evidence.icmsRate,12);
 const [failed]=evaluateTaxRules({...detailed,fiscal:{icmsRate:18}},company,[rule()]);assert.equal(failed.status,'DIVERGENTE');assert.equal(failed.priority,'alta');assert.match(failed.reason,/informado 18; esperado 12/);
 const result=audit([{...detailed,fiscal:{icmsRate:18}}],[],[company],[rule()]);
 assert.equal(result.entries[0].tax,12000);assert.equal(result.entries[0].status,'Revisar');assert.ok(result.alerts.some(a=>a.kind.startsWith('motor:')&&a.entryId===entry.id));
});
test('seletores desconhecidos exigem revisão; qualquer seletor incompatível exclui a regra',()=>{
 const r=rule({conditions:[{field:'ncm',operator:'in',values:['00000000']},{field:'uf',operator:'in',values:['SP']}]});
 assert.equal(evaluateTaxRules(entry,company,[r])[0].status,'REVISAR');
 assert.deepEqual(evaluateTaxRules(entry,{...company,uf:'MG'},[r]),[]);
 assert.equal(evaluateTaxRules(detailed,company,[r])[0].status,'OK');
 assert.equal(evaluateTaxRules(detailed,undefined,[r])[0].status,'REVISAR');
 const words=rule({conditions:[{field:'productDescription',operator:'containsAll',values:['sem açúcar']}]});
 assert.equal(evaluateTaxRules(detailed,company,[words])[0].status,'OK');
 assert.deepEqual(evaluateTaxRules({...detailed,fiscal:{...detailed.fiscal,productDescription:'Produto fictício com açúcar'}},company,[words]),[]);
});
test('regras sobrepostas e mudanças de vigência dentro do mês não concluem',()=>{
 const a=rule(),b=rule();assert.ok(evaluateTaxRules(detailed,company,[a,b]).every(f=>f.status==='REVISAR'&&f.reason.includes('mesmo campo')));
 const mid=rule({start:'2026-08-15'});assert.equal(evaluateTaxRules(detailed,company,[mid])[0].status,'REVISAR');
 assert.deepEqual(evaluateTaxRules({...detailed,date:'2026-08-10'},company,[mid]),[]);
 assert.equal(evaluateTaxRules({...detailed,date:'2026-08-15'},company,[mid])[0].status,'OK');
 assert.equal(evaluateTaxRules(detailed,company,[rule({start:'2026-08-01',end:'2026-08-31'})])[0].status,'OK');
});
test('tax zero é evidência; imposto não confirmado não é usado no crédito',()=>{
 const r=rule({conditions:[{field:'direction',operator:'in',values:['entrada']},{field:'cfop',operator:'in',values:['1102']}],checks:[{field:'tax',operator:'equals',values:['0'],severity:'alta',message:'Possível crédito indevido segundo o critério fictício.'}]});
 assert.equal(evaluateTaxRules({...entry,tax:0},company,[r])[0].status,'OK');
 assert.equal(evaluateTaxRules({...entry,taxConfirmed:false},company,[r])[0].status,'REVISAR');
 assert.equal(evaluateTaxRules(entry,company,[r])[0].status,'DIVERGENTE');
});
test('parser reconhece dados fiscais opcionais sem mudar a linha original',()=>{
 const header='CFOP;Valor Contábil;Base de Cálculo;Imposto Creditado;Isentas ou Não tributadas;Outras;NCM;CST ICMS;Alíquota ICMS;Descrição do Produto;MVA';
 const line='1102;1000,00;1000,00;120,00;0,00;0,00;00000000;000;12,00;Produto fictício;34,74';
 const options={companyId:'01',period:'2026-08',importId:'t',taxMode:'confirmar' as const,filename:'teste.csv'};
 const [e]=parseReport(Buffer.from(header+'\n'+line),options).entries;
 assert.equal(e.raw,line);assert.equal(e.fiscal?.ncm,'00000000');assert.equal(e.fiscal?.cstIcms,'000');assert.equal(e.fiscal?.mva,34.74);assert.equal(e.fiscal?.icmsRate,12);
 assert.throws(()=>parseReport(Buffer.from(header+'\n'+line.replace('00000000','123')),options),/ncm inválido/);
 assert.throws(()=>parseReport(Buffer.from(header+'\n'+line.replace('12,00;Produto','12%;Produto')),options),/percentual/);
});
test('JSON é material de referência e percentuais históricos não são transformados em verificações',()=>{
 const source={meta:{nome:'Pacote de testes',versao:'1'},icms_sp:{regras_gerais:[{id:'EXEMPLO',aliquota_referencia_percentual:12,acao:'Instrução não executável'}]},casos_validados_historicos:[{produto:'Produto fictício',regra:'ST',mva_referencia:'99%'}],extra:{preservar:true}};
 const parsed=parseTaxPackage(Buffer.from(JSON.stringify(source)));
 assert.equal(parsed.seeds.length,2);assert.deepEqual(parsed.seeds[0].source,source.icms_sp.regras_gerais[0]);assert.equal('checks' in parsed.seeds[0],false);
 assert.throws(()=>parseTaxPackage(Buffer.from('{}')));
});

test('descrições permitem expressões obrigatórias e proibidas na mesma regra',()=>{
 const r=rule({conditions:[{field:'productDescription',operator:'containsAll',values:['produto fictício']},{field:'productDescription',operator:'excludes',values:['com açúcar']}]});
 assert.equal(taxRuleInput.safeParse(input(r)).success,true);
 assert.equal(evaluateTaxRules(detailed,company,[r])[0].status,'OK');
 assert.deepEqual(evaluateTaxRules({...detailed,fiscal:{...detailed.fiscal,productDescription:'Produto fictício com açúcar'}},company,[r]),[]);
});
