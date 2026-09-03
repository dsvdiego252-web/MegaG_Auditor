import type { Alert, Company, Entry, EvaluatedEntry, Rule, Transfer } from './types';
export function audit(entries:Entry[],rules:Rule[],companies:Company[]) {
  const alerts: Alert[]=[]; const transfers:Transfer[]=[];
  const add=(e:Entry,kind:string,title:string,reason:string,priority:'alta'|'media'|'baixa'='media')=>alerts.push({id:`${e.id}:${kind}`,entryId:e.id,companyId:e.companyId,priority,title,reason,amount:e.tax,kind});
  const evaluated:EvaluatedEntry[]=entries.map(e=>{
    const company=companies.find(c=>c.id===e.companyId);
    const matching=rules.filter(r=>r.active&&r.cfop===e.cfop&&(!r.companyId||r.companyId===e.companyId)&&(!r.uf||r.uf===company?.uf)&&r.start<=e.period&&(!r.end||r.end>=e.period));
    const reasons:string[]=[];
    const rule=matching.length===1?matching[0]:undefined;
    if(!rule) { const reason=matching.length?'Mais de uma regra aplicável. Resolva a sobreposição antes de concluir.':'Nenhuma regra cadastrada para este CFOP, empresa, UF e competência. Não há conclusão tributária automática.'; reasons.push(reason); add(e,'regra',matching.length?'Regras sobrepostas':'CFOP sem regra fiscal',reason); }
    if(rule) {
      if(rule.category==='revisar'||rule.credit==='revisar') {reasons.push(rule.reason);add(e,'criterio','Regra exige revisão',rule.reason);}
      if(e.direction==='entrada'&&e.tax>0&&rule.credit==='vedar') { const reason=`Possível crédito indevido: a regra cadastrada veda crédito, mas a linha informa imposto creditado. ${rule.reason} Referência: ${rule.reference}`;reasons.push(reason);add(e,'credito-indevido','Possível crédito indevido',reason,'alta'); }
      if(e.direction==='entrada'&&e.tax===0&&e.base>0&&rule.credit==='permitir'&&rule.expectCredit) { const reason=`Possível crédito não aproveitado: base positiva e crédito zero; a regra configurada exige conferir o aproveitamento. Nenhum crédito foi calculado ou presumido. ${rule.reason}`;reasons.push(reason);add(e,'credito-ausente','Possível crédito não aproveitado',reason); }
    }
    if(!e.taxConfirmed) {const reason='O relatório chama a coluna de “Imposto Creditado” também nas saídas. Confirme o mapeamento para considerá-la débito.';reasons.push(reason);add(e,'coluna','Débito ainda não confirmado',reason,'alta');}
    if(e.amount<0||e.base<0||e.tax<0) {const reason='Valor negativo na origem. Conferir estorno ou ajuste sem normalizar o sinal.';reasons.push(reason);add(e,'negativo','Valor negativo na origem',reason);}
    return {...e,category:rule?.category??'revisar',operation:rule?.operation,ruleId:rule?.id,reasons,status:reasons.length?'Revisar':'Conferido'};
  });
  const transferEntries=evaluated.filter(e=>e.operation==='transferencia');
  const keys=new Map<string,EvaluatedEntry[]>();
  for(const e of transferEntries) {
    if(!e.key) {transfers.push({id:e.id,entryIds:[e.id],amount:e.amount,status:'Revisar',reason:'Linha agregada sem chave NF-e. Importe o relatório detalhado para cruzar saída e entrada.'});continue;}
    const group=keys.get(e.key)??[];group.push(e);keys.set(e.key,group);
  }
  for(const [key,group] of keys) {
    const incoming=group.filter(e=>e.direction==='entrada'), outgoing=group.filter(e=>e.direction==='saida');
    let status:Transfer['status']='Revisar',reason='Mais de uma linha por lado da NF-e. Conferir duplicidade ou desdobramento do documento.';
    if(!incoming.length||!outgoing.length) {status='Não encontrado';reason='A chave NF-e foi encontrada em apenas um lado da transferência nesta competência.';}
    else if(incoming.length===1&&outgoing.length===1) {
      const [a,b]=[incoming[0],outgoing[0]];
      if(a.companyId===b.companyId) reason='Entrada e saída estão atribuídas à mesma empresa.';
      else if(a.amount!==b.amount) reason='Os valores contábeis de entrada e saída divergem.';
      else if(!a.counterpart||!b.counterpart) reason='Chave e valores coincidem, mas a empresa contraparte não foi informada nos dois lados.';
      else if(a.counterpart!==b.companyId||b.counterpart!==a.companyId) reason='As empresas contraparte não correspondem às empresas de entrada e saída.';
      else {status='Conferido';reason='Chave NF-e, empresas contraparte e valores coincidem. Conferência documental; não valida o tratamento tributário.';}
    }
    transfers.push({id:key,key,entryIds:group.map(e=>e.id),amount:outgoing.reduce((s,e)=>s+e.amount,0)||incoming.reduce((s,e)=>s+e.amount,0),status,reason});
  }
  for(const t of transfers.filter(t=>t.status!=='Conferido')) {const e=evaluated.find(e=>e.id===t.entryIds[0])!;add(e,'transferencia',`Transferência: ${t.status.toLowerCase()}`,t.reason);}
  for(const company of companies) if(!company.uf) alerts.push({id:`uf:${company.id}`,companyId:company.id,priority:'media',title:'UF da empresa não confirmada',reason:'Confirme a UF no cadastro. Regras estaduais só se aplicam quando a UF corresponder exatamente.',kind:'cadastro'});
  alerts.sort((a,b)=>({alta:0,media:1,baixa:2}[a.priority]-{alta:0,media:1,baixa:2}[b.priority]));
  return {entries:evaluated,alerts,transfers};
}
export function totals(entries:EvaluatedEntry[]) {
  const sum=(predicate:(e:EvaluatedEntry)=>boolean,field:'amount'|'tax'='amount')=>entries.filter(predicate).reduce((s,e)=>s+e[field],0);
  const credit=sum(e=>e.direction==='entrada','tax');
  const debit=sum(e=>e.direction==='saida'&&e.taxConfirmed,'tax');
  return {incoming:sum(e=>e.direction==='entrada'),outgoing:sum(e=>e.direction==='saida'),purchases:sum(e=>e.operation==='compra'),sales:sum(e=>e.operation==='venda'),credit,debit,balance:debit-credit,complete:!entries.some(e=>!e.taxConfirmed),review:sum(e=>e.category==='revisar')};
}
