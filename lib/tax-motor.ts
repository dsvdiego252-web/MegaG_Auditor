import {z} from 'zod';
import type {Company,Entry} from './types';

// Facts are reported values. In particular, the rate is never inferred from tax/base.
export const FACTS={
  companyId:{label:'Empresa (01 a 06)',numeric:false},uf:{label:'UF da empresa',numeric:false},
  direction:{label:'Sentido (entrada / saida)',numeric:false},cfop:{label:'CFOP',numeric:false},
  ncm:{label:'NCM',numeric:false},cest:{label:'CEST',numeric:false},cstIcms:{label:'CST ICMS',numeric:false},
  csosn:{label:'CSOSN',numeric:false},cbenef:{label:'cBenef',numeric:false},
  productDescription:{label:'Descrição do produto',numeric:false},cnae:{label:'CNAE',numeric:false},regime:{label:'Regime tributário',numeric:false},
  ufOrigem:{label:'UF de origem',numeric:false},ufDestino:{label:'UF de destino',numeric:false},
  icmsRate:{label:'Alíquota ICMS (%) informada',numeric:true},mva:{label:'MVA (%) informada',numeric:true},
  base:{label:'Base ICMS (R$)',numeric:true},tax:{label:'ICMS informado (R$)',numeric:true},amount:{label:'Valor contábil (R$)',numeric:true}
} as const;
export type FactField=keyof typeof FACTS;
const field=z.enum(Object.keys(FACTS) as [FactField,...FactField[]]);
export type TaxFacts=Partial<Record<FactField,string|number>>;
const value=z.string().trim().min(1).max(300);
const condition=z.object({field,operator:z.enum(['in','containsAll','excludes']),values:z.array(value).min(1).max(20)}).strict().superRefine((c,ctx)=>{
  if(FACTS[c.field].numeric||c.operator!=='in'&&c.field!=='productDescription')ctx.addIssue({code:'custom',message:'Condições aceitam códigos ou palavras da descrição; valores numéricos pertencem às verificações.'});
});
const check=z.object({field,operator:z.enum(['in','equals','between']),values:z.array(value).min(1).max(20),severity:z.enum(['alta','media','baixa']),message:z.string().trim().min(10).max(1000)}).strict().superRefine((c,ctx)=>{
  const numeric=FACTS[c.field].numeric;
  if(numeric?c.operator==='in':c.operator!=='in')ctx.addIssue({code:'custom',message:'Use igualdade/faixa para números e lista de valores para códigos.'});
  if(numeric&&(c.values.length!==(c.operator==='between'?2:1)||c.values.some(v=>!/^\d+(?:\.\d{1,4})?$/.test(v))||c.values.some(v=>!Number.isFinite(Number(v))||Number(v)>1e13)||c.operator==='between'&&Number(c.values[0])>Number(c.values[1])))ctx.addIssue({code:'custom',message:'Informe valores numéricos válidos (ponto decimal); faixa exige mínimo e máximo em ordem.'});
});
const date=z.string().refine(v=>v===''||/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'Data inválida.');
export const taxRuleInput=z.object({
  id:z.string().uuid(),version:z.number().int().positive(),title:z.string().trim().min(3).max(250),
  domain:z.enum(['ICMS','PIS/COFINS','IBS/CBS','Procedimento']),status:z.enum(['pendente','validada','inativa']),
  start:date,end:date,reference:z.string().trim().max(2000),reason:z.string().trim().max(3000),
  conditions:z.array(condition).max(20),requiredFields:z.array(field).max(20),checks:z.array(check).max(10)
}).strict().superRefine((r,ctx)=>{
  if(r.end&&(!r.start||r.end<r.start))ctx.addIssue({code:'custom',message:'Vigência final anterior à inicial.'});
  if(new Set(r.conditions.map(c=>c.field+':'+c.operator)).size!==r.conditions.length)ctx.addIssue({code:'custom',message:'Use uma condição por campo e operador, reunindo os valores na mesma lista.'});
  if(new Set(r.checks.map(c=>c.field)).size!==r.checks.length)ctx.addIssue({code:'custom',message:'Use uma verificação por campo.'});
  if(r.status==='validada'){
    if(r.domain!=='ICMS')ctx.addIssue({code:'custom',message:'Nesta fase, somente verificações de ICMS podem ser ativadas.'});
    if(!r.start||r.reference.length<5||r.reason.length<15||!r.conditions.length||!r.checks.length)ctx.addIssue({code:'custom',message:'Para validar, informe vigência, fundamento, justificativa, condições de aplicação e verificações.'});
    if(!r.conditions.some(c=>c.operator!=='excludes'&&['cfop','ncm','cest','productDescription','cbenef','cstIcms','csosn'].includes(c.field)))ctx.addIssue({code:'custom',message:'Delimite a operação ou mercadoria por CFOP, NCM, CEST, descrição, cBenef ou CST/CSOSN.'});
  }
});
export type TaxRuleInput=z.infer<typeof taxRuleInput>;
export type TaxRule=TaxRuleInput&{packageId:string;sourcePath:string;source:unknown;updatedAt:string;updatedBy:string;validatedBy?:string;validatedAt?:string};
export type TaxPackage={id:string;name:string;version:string;filename:string;hash:string;importedAt:string;importedBy:string;ruleCount:number};
export type TaxFinding={ruleId:string;version:number;title:string;status:'OK'|'REVISAR'|'DIVERGENTE';priority:'alta'|'media'|'baixa';reason:string;reference:string;sourcePath:string;packageId:string;missing:FactField[];evidence:TaxFacts};
const text=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ');
function conditionMatches(actual:string,operator:TaxRule['conditions'][number]['operator'],values:string[]){
  const a=text(actual),vs=values.map(text);
  // Match whole words/phrases rather than arbitrary substrings of a product name.
  const words=(v:string)=>(' '+a.replace(/[^\p{L}\p{N}]+/gu,' ')+' ').includes(' '+v.replace(/[^\p{L}\p{N}]+/gu,' ')+' ');
  return operator==='in'?vs.includes(a):operator==='containsAll'?vs.every(words):vs.every(v=>!words(v));
}
export function entryFacts(e:Entry,company?:Company):TaxFacts{
  return {...e.fiscal,companyId:e.companyId,...(company?.uf?{uf:company.uf}:{}),...(company?.cnae?{cnae:company.cnae}:{}),...(company?.regime?{regime:company.regime}:{}),direction:e.direction,cfop:e.cfop,amount:e.amount/100,base:e.base/100,...(e.taxConfirmed?{tax:e.tax/100}:{})};
}
export function evaluateTaxRules(e:Entry,company:Company|undefined,rules:TaxRule[]):TaxFinding[]{
  const facts=entryFacts(e,company),candidates:{rule:TaxRule;missing:FactField[];dateMissing:boolean}[]=[];
  const first=e.period+'-01',last=new Date(Date.UTC(Number(e.period.slice(0,4)),Number(e.period.slice(5,7)),0)).toISOString().slice(0,10);
  for(const rule of rules){
    if(rule.status!=='validada'||rule.domain!=='ICMS')continue;
    const start=e.date||first,end=e.date||last;
    if(rule.start>end||rule.end&&rule.end<start)continue;
    const missing:FactField[]=[];let mismatch=false;
    for(const c of rule.conditions){const actual=facts[c.field];if(actual===undefined||actual==='')missing.push(c.field);else if(!conditionMatches(String(actual),c.operator,c.values))mismatch=true;}
    if(mismatch)continue;
    for(const f of [...rule.requiredFields,...rule.checks.map(c=>c.field)])if(facts[f]===undefined||facts[f]==='')missing.push(f);
    candidates.push({rule,missing:[...new Set(missing)],dateMissing:!e.date&&(rule.start>first||!!rule.end&&rule.end<last)});
  }
  return candidates.map(({rule,missing,dateMissing})=>{
    const evidence:TaxFacts={};for(const f of [...rule.conditions.map(c=>c.field),...rule.requiredFields,...rule.checks.map(c=>c.field)])if(facts[f]!==undefined)evidence[f]=facts[f];
    const finding:TaxFinding={ruleId:rule.id,version:rule.version,title:rule.title,status:'OK',priority:'baixa',reason:'',reference:rule.reference,sourcePath:rule.sourcePath,packageId:rule.packageId,missing,evidence};
    const suffix=` Critério: ${rule.reason} Referência: ${rule.reference}. Regra ${rule.title}, versão ${rule.version}.`;
    if(missing.length||dateMissing)return {...finding,status:'REVISAR',priority:'media',reason:'Não é possível concluir: '+[...(missing.length?['faltam '+missing.map(f=>FACTS[f].label).join(', ')]:[]),...(dateMissing?['a vigência muda dentro da competência e a fonte não informa a data do lançamento']:[])].join('; ')+'.'+suffix};
    const overlapping=candidates.filter(c=>c.rule.id!==rule.id&&c.rule.checks.some(a=>rule.checks.some(b=>a.field===b.field)));
    if(overlapping.length)return {...finding,status:'REVISAR',priority:'media',reason:'Mais de uma regra candidata verifica o mesmo campo: '+overlapping.map(c=>c.rule.title).join(', ')+'. Delimite os critérios antes de concluir.'+suffix};
    const failed=rule.checks.filter(c=>{
      const actual=facts[c.field]!;
      if(c.operator==='in')return !c.values.map(text).includes(text(String(actual)));
      return c.operator==='equals'?Number(actual)!==Number(c.values[0]):Number(actual)<Number(c.values[0])||Number(actual)>Number(c.values[1]);
    });
    if(failed.length){const priority=failed.some(c=>c.severity==='alta')?'alta':failed.some(c=>c.severity==='media')?'media':'baixa';return {...finding,status:'DIVERGENTE',priority,reason:failed.map(c=>`${c.message} ${FACTS[c.field].label}: informado ${facts[c.field]}; esperado ${c.values.join(c.operator==='between'?' a ':' ou ')}.`).join(' ')+suffix};}
    return {...finding,reason:'Os valores informados atendem às verificações cadastradas. Isso não confirma o enquadramento integral do documento.'+suffix};
  });
}
