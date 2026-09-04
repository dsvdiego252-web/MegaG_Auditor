import type {Alert,Company,Entry,EvaluatedEntry,Rule} from './types';
import type {CfopMasterRule} from './cfop-master';
import {analyzeMovement,type AuditSettings} from './movement-audit';
import {evaluateTaxRules,type TaxRule} from './tax-motor';
export function evaluateCfopEntries(entries:Entry[],rules:Rule[],companies:Company[],taxRules:TaxRule[],masterRules:CfopMasterRule[],settings:AuditSettings,alerts:Alert[]):EvaluatedEntry[]{
 return entries.map(e=>{
  const company=companies.find(c=>c.id===e.companyId),a=analyzeMovement(e,company,masterRules,rules,settings);
  const taxFindings=evaluateTaxRules(e,company,taxRules),reasons=a.findings.map(f=>f.reason);
  const fields={entryId:e.id,companyId:e.companyId,period:e.period,cfop:e.cfop,cst:String(e.fiscal?.cstIcms||e.fiscal?.csosn||''),ruleId:a.regra_aplicada,reference:a.fundamento};
  for(const [index,f] of a.findings.entries())alerts.push({...f,...fields,id:e.id+':'+f.kind+':'+index,amount:f.kind==='reconciliacao'?Math.abs(a.reconciliation.difference):e.tax});
  for(const f of taxFindings)if(f.status!=='OK'){reasons.push(f.reason);alerts.push({...fields,id:e.id+':motor:'+f.ruleId,kind:'motor:'+f.ruleId,title:'Motor tributário: '+f.title,reason:f.reason,priority:f.priority,amount:e.tax,action:'Conferir as evidências e os critérios da regra tributária.'});}
  const items=e.items?.length?evaluateCfopEntries(e.items,rules,companies,taxRules,masterRules,settings,alerts):undefined;
  if(items?.some(i=>i.status==='Revisar'))reasons.push('Há itens com pendências. Abra o detalhamento dos itens deste registro.');
  const operation=a.grupo==='TRANSFERENCIA'?'transferencia':a.impacta_compras==='SIM'?'compra':a.impacta_faturamento==='SIM'?'venda':'outra';
  const category=({TRIBUTADO:'tributada',ISENTO_NAO_TRIBUTADO:'isenta',SUBSTITUICAO_TRIBUTARIA:'st',OUTRAS:'outras',MISTO:'revisar',REVISAR:'revisar'} as const)[a.classificacao];
  return {...e,...(items?{items}:{}),cfopAnalysis:a,taxFindings,operation,category,ruleId:a.manualRuleId||a.regra_aplicada,reasons,status:reasons.length||a.classificacao==='REVISAR'?'Revisar':'Conferido'};
 });
}
export function flattenEntries(entries:Entry[]):EvaluatedEntry[]{return entries.flatMap(e=>[e as EvaluatedEntry,...flattenEntries(e.items||[])]);}
