import type { Alert, Company, Entry, EvaluatedEntry, Rule, Transfer, TransferCfop } from './types';
import {TRANSFER_CFOPS,TRANSFER_CATALOG_SOURCE} from './transfer-catalog';
export function audit(entries:Entry[],rules:Rule[],companies:Company[]) {
  const alerts:Alert[]=[],transfers:Transfer[]=[];
  const add=(e:Entry,kind:string,title:string,reason:string,priority:'alta'|'media'|'baixa'='media')=>alerts.push({id:`${e.id}:${kind}`,entryId:e.id,companyId:e.companyId,priority,title,reason,amount:e.tax,kind});
  const evaluated:EvaluatedEntry[]=entries.map(e=>{
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
    if(operation==='transferencia'){
      const counterpart=companies.find(c=>c.id===e.counterpart);
      let reason='';
      if(e.counterpart===e.companyId)reason='A contraparte da transferência é a própria empresa.';
      else if(!company?.uf||!counterpart?.uf)reason='Não há UF e contraparte suficientes para conferir se o CFOP é interno ou interestadual. A identificação da transferência por CFOP foi preservada.';
      else if(!['1','2','5','6'].includes(e.cfop[0]))reason='O CFOP configurado não representa uma operação interna ou interestadual entre as empresas do grupo.';
      else if(['2','6'].includes(e.cfop[0])!==(company.uf!==counterpart.uf))reason='O prefixo do CFOP diverge das UFs das empresas: '+company.uf+' → '+counterpart.uf+'. Confira se a transferência é interna ou interestadual.';
      if(reason){reasons.push(reason);add(e,'transferencia-uf','Transferência: conferir CFOP e UFs',reason);}
    }
    if(!e.taxConfirmed){const reason='A coluna '+(e.taxLabel||'de imposto')+' não corresponde ao sentido '+e.direction+' do CFOP. Confirme o mapeamento para incluir o valor no crédito/débito e no saldo.';reasons.push(reason);add(e,'coluna','Mapeamento do ICMS pendente',reason,'alta');}
    if(e.amount<0||e.base<0||e.tax<0){const reason='Valor negativo na origem. Conferir estorno ou ajuste sem normalizar o sinal.';reasons.push(reason);add(e,'negativo','Valor negativo na origem',reason);}
    return {...e,category:rule?.category??'revisar',operation,ruleId:rule?.id,reasons,status:reasons.length?'Revisar':'Conferido'};
  });
  const transferEntries=evaluated.filter(e=>e.operation==='transferencia');
  const byCfop=new Map<string,EvaluatedEntry[]>();
  for(const e of transferEntries){const id=e.companyId+':'+e.cfop;const group=byCfop.get(id)||[];group.push(e);byCfop.set(id,group);}
  const transferCfops:TransferCfop[]=Array.from(byCfop,([id,group])=>({id,companyId:group[0].companyId,cfop:group[0].cfop,direction:group[0].direction,amount:group.reduce((s,e)=>s+e.amount,0),tax:group.reduce((s,e)=>s+e.tax,0),entryIds:group.map(e=>e.id),status:group.some(e=>e.status==='Revisar')?'Revisar':'Conferido',description:TRANSFER_CFOPS[group[0].cfop]?.description||'Transferência identificada pela regra cadastrada',reasons:[...new Set(group.flatMap(e=>e.reasons))],reference:TRANSFER_CFOPS[group[0].cfop]?TRANSFER_CATALOG_SOURCE:rules.find(r=>r.id===group[0].ruleId)?.reference||''}));
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
  alerts.sort((a,b)=>({alta:0,media:1,baixa:2}[a.priority]-{alta:0,media:1,baixa:2}[b.priority]));
  return {entries:evaluated,alerts,transfers,transferCfops};
}
export function totals(entries:EvaluatedEntry[]){
  const sum=(predicate:(e:EvaluatedEntry)=>boolean,field:'amount'|'tax'='amount')=>entries.filter(predicate).reduce((s,e)=>s+e[field],0);
  const credit=sum(e=>e.direction==='entrada'&&e.taxConfirmed,'tax'),debit=sum(e=>e.direction==='saida'&&e.taxConfirmed,'tax');
  return {incoming:sum(e=>e.direction==='entrada'),outgoing:sum(e=>e.direction==='saida'),purchases:sum(e=>e.operation==='compra'),sales:sum(e=>e.operation==='venda'),credit,debit,balance:debit-credit,creditComplete:!entries.some(e=>e.direction==='entrada'&&!e.taxConfirmed),debitComplete:!entries.some(e=>e.direction==='saida'&&!e.taxConfirmed),complete:!entries.some(e=>!e.taxConfirmed),review:sum(e=>e.category==='revisar')};
}
