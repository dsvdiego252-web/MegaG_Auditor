import type { Alert, Company, Entry, EvaluatedEntry, Rule, Transfer, TransferCfop, UfCheck } from './types';
import {evaluateCfopEntries} from './cfop-audit';
import type {CfopMasterRule} from './cfop-master';
import {hierarchyReconciliation,DEFAULT_AUDIT_SETTINGS,type AuditSettings} from './movement-audit';
import type {ImportRecord} from './types';
import {cfopScope} from './cfop';
import {TRANSFER_CFOPS,TRANSFER_CATALOG_SOURCE} from './transfer-catalog';
import {evaluateTaxRules,type TaxRule} from './tax-motor';
export function audit(entries:Entry[],rules:Rule[],companies:Company[],taxRules:TaxRule[]=[],options?:{masterRules:CfopMasterRule[];settings:AuditSettings;imports?:ImportRecord[]}) {
  const alerts:Alert[]=[],transfers:Transfer[]=[];
  const add=(e:Entry,kind:string,title:string,reason:string,priority:'alta'|'media'|'baixa'='media')=>alerts.push({id:`${e.id}:${kind}`,entryId:e.id,companyId:e.companyId,priority,title,reason,amount:e.tax,kind});
  const evaluated:EvaluatedEntry[]=options?.masterRules.length?evaluateCfopEntries(entries,rules,companies,taxRules,options.masterRules,options.settings,alerts):entries.map(e=>{
    const company=companies.find(c=>c.id===e.companyId);
    const matching=rules.filter(r=>r.active&&r.cfop===e.cfop&&(!r.companyId||r.companyId===e.companyId)&&(!r.uf||r.uf===company?.uf)&&r.start<=e.period&&(!r.end||r.end>=e.period));
    const reasons:string[]=[],rule=matching.length===1?matching[0]:undefined;
    const catalog=TRANSFER_CFOPS[e.cfop];
    if(!rule){const reason=matching.length?'Mais de uma regra aplicável. Resolva a sobreposição antes de concluir.':'Nenhuma regra cadastrada para este CFOP, empresa, UF e competência. Não há conclusão tributária automática.';reasons.push(reason);add(e,'regra',matching.length?'Regras sobrepostas':'CFOP sem regra fiscal',reason);}
    if(rule){
      if(rule.category==='revisar'||rule.credit==='revisar'){reasons.push(rule.reason);add(e,'criterio','Regra exige revisão',rule.reason);}
      if(e.taxConfirmed&&e.direction==='entrada'&&e.tax>0&&rule.credit==='vedar'){const reason=`Possível crédito indevido: a regra cadastrada veda crédito, mas a linha informa imposto creditado. ${rule.reason} Referência: ${rule.reference}`;reasons.push(reason);add(e,'credito-indevido','Possível crédito indevido',reason,'alta');}
      if(e.taxConfirmed&&e.direction==='entrada'&&e.tax===0&&e.base>0&&rule.credit==='permitir'&&rule.expectCredit){const reason=`Possível crédito não aproveitado: base positiva e crédito zero; a regra configurada exige conferir o aproveitamento. Nenhum crédito foi calculado ou presumido. ${rule.reason}`;reasons.push(reason);add(e,'credito-ausente','Possível crédito não aproveitado',reason);}
      if(catalog&&rule.operation!=='transferencia'){const reason='O catálogo identifica este CFOP como transferência, mas a regra cadastrada informa outra natureza. Revise o cadastro antes de concluir.';reasons.push(reason);add(e,'transferencia-cfop','Natureza do CFOP diverge da regra',reason,'alta');}
    }
    const operation=catalog?'transferencia':rule?.operation;
    let ufCheck:UfCheck|undefined;
    if(operation==='transferencia'){
      const counterpart=companies.find(c=>c.id===e.counterpart),scope=cfopScope(e.cfop);
      let reason='';
      if(e.counterpart===e.companyId)reason='A contraparte da transferência é a própria empresa.';
      else if(!scope||scope.scope==='exterior')reason='O CFOP configurado não representa uma operação interna ou interestadual entre as empresas do grupo.';
      else if(!company?.uf||!counterpart?.uf)ufCheck={status:'Pendente',reason:scope.label+'. A conferência das UFs das empresas aguarda o cadastro da contraparte e suas UFs no relatório detalhado.'};
      else if((scope.scope==='interestadual')!==(company.uf!==counterpart.uf))reason=scope.label+', mas as UFs cadastradas ('+company.uf+' e '+counterpart.uf+') contradizem essa abrangência. Confira o CFOP e os cadastros.';
      else ufCheck={status:'Conferido',reason:scope.label+'. As UFs cadastradas ('+company.uf+' e '+counterpart.uf+') são compatíveis com o CFOP.'};
      if(reason){ufCheck={status:'Divergente',reason};reasons.push(reason);add(e,'transferencia-uf','Transferência: divergência de CFOP e UFs',reason);}
    }
    if(!e.taxConfirmed){const reason='A coluna '+(e.taxLabel||'de imposto')+' não corresponde ao sentido '+e.direction+' do CFOP. Confirme o mapeamento para incluir o valor no crédito/débito e no saldo.';reasons.push(reason);add(e,'coluna','Mapeamento do ICMS pendente',reason,'alta');}
    if(e.amount<0||e.base<0||e.tax<0){const reason='Valor negativo na origem. Conferir estorno ou ajuste sem normalizar o sinal.';reasons.push(reason);add(e,'negativo','Valor negativo na origem',reason);}
    const taxFindings=evaluateTaxRules(e,company,taxRules);
    for(const finding of taxFindings)if(finding.status!=='OK'){reasons.push(finding.reason);add(e,'motor:'+finding.ruleId,'Motor tributário: '+finding.title,finding.reason,finding.priority);}
    return {...e,...(ufCheck?{ufCheck}:{}),...(taxFindings.length?{taxFindings}:{}),category:rule?.category??'revisar',operation,ruleId:rule?.id,reasons,status:reasons.length?'Revisar':'Conferido'};
  });
  if(options?.masterRules.length)for(const e of evaluated.filter(e=>e.operation==='transferencia')){
    const company=companies.find(c=>c.id===e.companyId),counterpart=companies.find(c=>c.id===e.counterpart),scope=cfopScope(e.cfop);
    if(e.counterpart===e.companyId)e.ufCheck={status:'Divergente',reason:'A contraparte é a própria empresa.'};
    else if(!company?.uf||!counterpart?.uf)e.ufCheck={status:'Pendente',reason:(scope?.label||'Abrangência a revisar')+'. A conferência documental aguarda as UFs das duas empresas.'};
    else if(!scope||scope.scope==='exterior'||(scope.scope==='interestadual')!==(company.uf!==counterpart.uf))e.ufCheck={status:'Divergente',reason:'As UFs '+company.uf+' / '+counterpart.uf+' contradizem a abrangência do CFOP.'};
    else e.ufCheck={status:'Conferido',reason:(scope?.label||'')+'. UFs das contrapartes conferidas.'};
    if(e.ufCheck.status==='Divergente'){e.status='Revisar';e.reasons.push(e.ufCheck.reason);add(e,'transferencia-uf','Transferência: divergência de UFs',e.ufCheck.reason);}
  }
  const transferEntries=evaluated.filter(e=>e.operation==='transferencia');
  const byCfop=new Map<string,EvaluatedEntry[]>();
  for(const e of transferEntries){const id=e.companyId+':'+e.cfop;const group=byCfop.get(id)||[];group.push(e);byCfop.set(id,group);}
  const transferCfops:TransferCfop[]=Array.from(byCfop,([id,group])=>({id,companyId:group[0].companyId,cfop:group[0].cfop,direction:group[0].direction,amount:group.reduce((s,e)=>s+e.amount,0),tax:group.reduce((s,e)=>s+e.tax,0),entryIds:group.map(e=>e.id),status:group.some(e=>e.status==='Revisar')?'Revisar':'Conferido',description:group[0].cfopAnalysis?.descricao||TRANSFER_CFOPS[group[0].cfop]?.description||'Transferência identificada pela regra cadastrada',reasons:[...new Set(group.flatMap(e=>e.reasons))],reference:group[0].cfopAnalysis?.fundamento||(TRANSFER_CFOPS[group[0].cfop]?TRANSFER_CATALOG_SOURCE:rules.find(r=>r.id===group[0].ruleId)?.reference||''),ufCheck:{status:group.some(e=>e.ufCheck?.status==='Divergente')?'Divergente':group.some(e=>e.ufCheck?.status!=='Conferido')?'Pendente':'Conferido',reason:[...new Set(group.flatMap(e=>e.ufCheck?[e.ufCheck.reason]:[]))].join(' ')}}));
  const keys=new Map<string,EvaluatedEntry[]>();
  for(const e of transferEntries){
    if(!e.key){transfers.push({id:e.id,entryIds:[e.id],amount:e.amount,status:'Revisar',cfopStatus:e.status,reason:'Linha agregada sem chave NF-e. A análise por CFOP está disponível; importe o relatório detalhado para cruzar saída e entrada.'});continue;}
    const group=keys.get(e.key)||[];group.push(e);keys.set(e.key,group);
  }
  for(const [key,group] of keys){
    const incoming=group.filter(e=>e.direction==='entrada'),outgoing=group.filter(e=>e.direction==='saida');
    let status:Transfer['status']='Revisar',cfopStatus:Transfer['cfopStatus']='Revisar',reason='Mais de uma linha por lado da NF-e. Conferir duplicidade ou desdobramento do documento.';
    if(!incoming.length||!outgoing.length){status='Não encontrado';reason='A chave NF-e foi encontrada em apenas um lado da transferência nesta competência.';}
    else if(incoming.length===1&&outgoing.length===1){
      const [a,b]=[incoming[0],outgoing[0]];
      const ra=rules.find(r=>r.id===a.ruleId),rb=rules.find(r=>r.id===b.ruleId);
      const pair=ra?.operation==='transferencia'&&rb?.operation==='transferencia'&&ra.pairedCfops?.includes(b.cfop)&&rb.pairedCfops?.includes(a.cfop);
      if(!pair)reason='Par de CFOPs '+a.cfop+' / '+b.cfop+' sem correspondência permitida nas duas regras aplicáveis. Cadastre os pares validados pela equipe fiscal.';
      else if(a.status==='Revisar'||b.status==='Revisar')reason='O par de CFOPs está cadastrado, mas há pendências nos lançamentos: '+[...new Set([...a.reasons,...b.reasons])].join(' ');
      else if(a.ufCheck?.status!=='Conferido'||b.ufCheck?.status!=='Conferido')reason='Os CFOPs identificam a abrangência da operação. A conciliação documental aguarda a conferência das UFs das duas empresas.';
      else {cfopStatus='Conferido';
        if(a.companyId===b.companyId)reason='Entrada e saída estão atribuídas à mesma empresa.';
        else if(a.amount!==b.amount)reason='Os valores contábeis de entrada e saída divergem.';
        else if(!a.counterpart||!b.counterpart)reason='Chave e valores coincidem, mas a empresa contraparte não foi informada nos dois lados.';
        else if(a.counterpart!==b.companyId||b.counterpart!==a.companyId)reason='As empresas contraparte não correspondem às empresas de entrada e saída.';
        else {status='Conferido';reason='Chave NF-e, valores, contrapartes, UFs e par de CFOPs atendem aos critérios cadastrados. O resultado não substitui a validação fiscal das regras.';}
      }
    }
    transfers.push({id:key,key,entryIds:group.map(e=>e.id),amount:outgoing.reduce((s,e)=>s+e.amount,0)||incoming.reduce((s,e)=>s+e.amount,0),status,cfopStatus,reason});
  }
  for(const t of transfers.filter(t=>t.status!=='Conferido')){const e=evaluated.find(e=>e.id===t.entryIds[0])!;add(e,'transferencia',`Transferência: ${t.status.toLowerCase()}`,t.reason);}
  for(const company of companies)if(!company.uf)alerts.push({id:`uf:${company.id}`,companyId:company.id,priority:'media',title:'UF da empresa não confirmada',reason:'Confirme a UF no cadastro. Regras estaduais só se aplicam quando a UF corresponder exatamente.',kind:'cadastro'});
  const pending=taxRules.filter(r=>r.domain==='ICMS'&&r.status==='pendente');
  if(pending.length)alerts.push({id:'motor:pendentes',priority:'media',title:'Motor tributário: referências pendentes',reason:pending.length+' referências de ICMS aguardam critérios, vigência e validação em Regras fiscais. Percentuais e casos históricos ainda não produzem conclusões automáticas.',kind:'motor'});
  const reconciliations=options?.masterRules.length?hierarchyReconciliation(evaluated,options.settings,options.imports):undefined;
  for(const r of reconciliations||[])if(r.status!=='OK'&&(r.id.includes(':C100:')||r.id.includes(':C170:')||r.level==='apuracao'))alerts.push({id:'reconciliacao:'+r.id,companyId:r.companyId,entryId:r.entryIds[0],kind:'reconciliacao-'+r.level,priority:r.status==='CRITICO'?'alta':'media',title:'Reconciliação: '+r.level,reason:r.reason+' Diferença: '+(r.difference/100).toFixed(2)+'.',amount:Math.abs(r.difference),action:'Conferir os registros de origem e explicar a diferença antes de concluir.'});
  for(const imp of options?.imports||[])for(const [index,warning] of (imp.coverageWarnings||[]).entries())alerts.push({id:imp.id+':cobertura:'+index,companyId:imp.companyId,kind:'cobertura-efd',priority:'alta',title:'Cobertura da EFD requer revisão',reason:warning});
  alerts.sort((a,b)=>({alta:0,media:1,baixa:2}[a.priority]-{alta:0,media:1,baixa:2}[b.priority]));
  return {entries:evaluated,alerts,transfers,transferCfops,...(reconciliations?{reconciliations}:{})};
}
export function totals(entries:EvaluatedEntry[]){
  const sum=(predicate:(e:EvaluatedEntry)=>boolean,field:'amount'|'tax'='amount')=>entries.filter(predicate).reduce((s,e)=>s+e[field],0);
  const credit=sum(e=>e.direction==='entrada'&&e.taxConfirmed,'tax'),debit=sum(e=>e.direction==='saida'&&e.taxConfirmed,'tax');
  return {incoming:sum(e=>e.direction==='entrada'),outgoing:sum(e=>e.direction==='saida'),purchases:sum(e=>e.cfopAnalysis?e.cfopAnalysis.impacta_compras==='SIM':e.operation==='compra'),sales:sum(e=>e.cfopAnalysis?e.cfopAnalysis.impacta_faturamento==='SIM':e.operation==='venda'),credit,debit,balance:debit-credit,creditComplete:!entries.some(e=>e.direction==='entrada'&&!e.taxConfirmed),debitComplete:!entries.some(e=>e.direction==='saida'&&!e.taxConfirmed),complete:!entries.some(e=>!e.taxConfirmed),review:entries.reduce((s,e)=>s+(e.cfopAnalysis?e.cfopAnalysis.classificacao==='REVISAR'?Math.abs(e.amount):Math.abs(e.cfopAnalysis.parts.revisar):e.category==='revisar'?Math.abs(e.amount):0),0)};
}
