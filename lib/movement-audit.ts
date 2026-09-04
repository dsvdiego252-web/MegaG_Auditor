import {z} from 'zod';
import type {Company,Entry,Rule,ImportRecord} from './types';
import {masterFor,resolveManual,type CfopMasterRule,type CfopGroup,type FiscalPermission,type Impact} from './cfop-master';
export type PartCategory='tributada'|'isenta'|'st'|'outras'|'revisar';
export type Parts={tributada:number;isenta:number;st:number;outras:number;revisar:number};
export type MovementClass='TRIBUTADO'|'ISENTO_NAO_TRIBUTADO'|'SUBSTITUICAO_TRIBUTARIA'|'OUTRAS'|'MISTO'|'REVISAR';
export const auditSettingsSchema=z.object({toleranceCents:z.number().int().min(0).max(100),tolerancePercent:z.number().min(0).max(.1),criticalCents:z.number().int().min(101).max(100000000),criticalPercent:z.number().min(.1).max(100)}).strict();
export type AuditSettings=z.infer<typeof auditSettingsSchema>;
export const DEFAULT_AUDIT_SETTINGS:AuditSettings={toleranceCents:1,tolerancePercent:.01,criticalCents:10000,criticalPercent:1};
export type MovementFinding={kind:string;title:string;reason:string;priority:'alta'|'media'|'baixa';action:string};
export type Reconciliation={level:'registro'|'item'|'documento'|'cfop_cst_aliquota'|'empresa'|'competencia'|'apuracao';id:string;companyId?:string;entryIds:string[];expected:number;classified:number;difference:number;absoluteDifference:number;percent:number|null;status:'OK'|'ATENCAO'|'CRITICO'|'REVISAR';reason:string};
export type CfopAnalysis={cfop:string;descricao:string;grupo:CfopGroup;movimento:'entrada'|'saida';ambito:string;classificacao:MovementClass;parts:Parts;credito_icms:FiscalPermission|'NAO_APLICAVEL';debito_icms:FiscalPermission|'NAO_APLICAVEL';impacta_faturamento:Impact;impacta_compras:Impact;regra_aplicada:string;fundamento:string;version:number;manualRuleId?:string;shadowed:string[];reconciliation:Reconciliation;findings:MovementFinding[];evidence:string[]};
export function reconcile(expected:number,classified:number,settings:AuditSettings,absoluteDifference=Math.abs(expected-classified)){
 const difference=expected-classified,percent=expected===0?null:Math.abs(difference)/Math.abs(expected)*100;
 const within=absoluteDifference<=settings.toleranceCents&&(expected===0?absoluteDifference===0:absoluteDifference/Math.abs(expected)*100<=settings.tolerancePercent);
 const critical=absoluteDifference>=settings.criticalCents||(expected!==0&&absoluteDifference/Math.abs(expected)*100>=settings.criticalPercent);
 return {expected,classified,difference,absoluteDifference,percent,status:within?'OK' as const:critical?'CRITICO' as const:'ATENCAO' as const};
}
const stCsts=['10','30','60','70'],ownCsts=['00','10','20','70'],exemptCsts=['40','41'];
export function analyzeMovement(e:Entry,company:Company|undefined,masters:CfopMasterRule[],rules:Rule[],settings=DEFAULT_AUDIT_SETTINGS):CfopAnalysis{
 const master=masterFor(e,masters),manual=resolveManual(e,company,rules),r=manual.rule;
 const findings:MovementFinding[]=[],evidence:string[]=[];
 const add=(kind:string,title:string,reason:string,action='Conferir o lançamento e as condições fiscais na fonte.',priority:MovementFinding['priority']='media')=>findings.push({kind,title,reason,action,priority});
 if(!master)add('cfop-oficial','CFOP sem versão oficial aplicável','Código não encontrado no catálogo para a data/competência, ou mudança de vigência sem data suficiente.','Consultar a tabela oficial da competência; não substituir o código automaticamente.','alta');
 if(manual.conflict)add('regra','Exceções manuais sobrepostas','Há mais de uma regra manual no nível de maior prioridade.','Delimitar empresa, UF e vigência das exceções.','alta');
 if(manual.shadowed.length)evidence.push('Exceção mais específica prevalece sobre: '+manual.shadowed.join(', '));
 if(r)evidence.push('Exceção manual preservada: '+r.id+' — '+r.reference);
 const own=e.taxConfirmed?e.tax:undefined,cstRaw=String(e.fiscal?.cstIcms||''),cst=cstRaw.slice(-2),csosn=String(e.fiscal?.csosn||'');
 const parts:Parts={tributada:e.reportedParts?.tributada??0,isenta:e.exempt,st:e.reportedParts?.st??0,outras:e.other,revisar:0};
 const stBase=e.stBase??0,stTax=e.stTax??0,stPosition=String(e.fiscal?.chainPosition||'').toLowerCase();
 const stRule=!!master&&/substituição tributária/i.test(master.descricao_oficial)||r?.category==='st';
 const stSituation=stCsts.includes(cst)||['201','202','203','500'].includes(csosn);
 const stConfirmed=stRule&&stSituation&&['substituto','substituido'].includes(stPosition)&&(!!e.fiscal?.cest||stBase>0||stTax>0)&&e.taxConfirmed;
 const hasOwn=e.base>0||(own??0)>0;
 const pureExempt=exemptCsts.includes(cst)||['103','300','400'].includes(csosn);
 const noOwnAllowed=pureExempt||cst==='30'||cst==='60'||csosn==='500';
 if(e.directionDeclared&&e.directionDeclared!==e.direction)add('cfop-movimento','CFOP e sentido do registro divergem','O sentido informado no registro é '+e.directionDeclared+', enquanto o primeiro dígito do CFOP indica '+e.direction+'.','Revisar CFOP e indicador de operação; não inverter valores.','alta');
 const origin=String(e.fiscal?.ufOrigem||''),destination=String(e.fiscal?.ufDestino||'');
 if(master&&origin&&destination){const domestic=origin!=='EX'&&destination!=='EX';if(master.ambito_operacao==='INTERNO'&&origin!==destination||master.ambito_operacao==='INTERESTADUAL'&&(!domestic||origin===destination)||master.ambito_operacao==='EXTERIOR'&&domestic)add('cfop-uf','Abrangência do CFOP diverge das UFs','CFOP '+e.cfop+': '+master.ambito_operacao+'; origem '+origin+' e destino '+destination+'.','Conferir as UFs e a natureza efetiva da operação.');}
 if(noOwnAllowed&&hasOwn)add('cst-incompativel','CST e tributação própria incompatíveis','CST/CSOSN '+(cstRaw||csosn)+' acompanhado de base ou ICMS próprio positivo.','Verificar se o agrupamento mistura situações e obter o detalhe por CST.','alta');
 if(own!==undefined&&own>0&&e.base===0)add('icms-sem-base','ICMS positivo sem base própria','Há ICMS informado e a base própria é zero.');
 if(e.base>0&&own===0){const kind=e.direction==='entrada'?'credito-ausente':'debito-ausente';add(kind,e.direction==='entrada'?'Possível crédito não aproveitado':'Possível débito não lançado','Base própria positiva e ICMS zero. O tratamento permanece condicionado ao CST, benefícios e demais condições legais; nenhum imposto foi calculado.','Conferir CST, benefício, finalidade e regra aplicável.');}
 if((stBase>0||stTax>0||parts.st!==0)&&!stConfirmed)add('st-nao-confirmada','ST requer confirmação','Valores de ST presentes sem conjunto suficiente de regra, CST/CSOSN, posição na cadeia e evidência de ST.','Completar ou conferir CST, CEST, base/ICMS-ST e posição da empresa na cadeia.');
 if(stSituation&&!stConfirmed)add('st-condicional','Tratamento ST pendente','O CST/CSOSN indica hipótese de ST; o CFOP isolado não confirma o enquadramento.');
 if(noOwnAllowed&&own!==undefined&&own>0)add(e.direction==='entrada'?'credito-indevido':'debito-indevido',e.direction==='entrada'?'Possível crédito indevido':'Débito potencialmente indevido','O CST/CSOSN declarado é incompatível com ICMS próprio positivo. O valor destacado exige revisão.','Conferir CST, base legal e composição do lançamento.','alta');
 if(e.direction==='entrada'&&own!==undefined&&own>0&&r?.credit==='vedar')add('credito-indevido','Possível crédito indevido','A exceção manual veda crédito, mas há ICMS creditado informado. '+r.reason+' Referência: '+r.reference,'Conferir o crédito e documentar eventual ajuste.','alta');
 if(e.direction==='saida'&&own!==undefined&&own>0&&r?.debit==='NAO')add('debito-indevido','Débito potencialmente indevido','A exceção manual indica ausência de débito, mas a origem informa imposto debitado. '+r.reason,'Revisar destaque, escrituração e fundamento antes de ajustar.','alta');
 // Explicit monetary parcels remain exactly as supplied, including negative values.
 if(stConfirmed&&e.reportedParts?.st===undefined){
  if(e.other===e.amount&&e.exempt===0&&!hasOwn){parts.st=e.other;parts.outras=0;evidence.push('Parcela informada em Outras identificada como ST pelos critérios completos; original preservado.');}
  else if(e.exempt===0&&e.other===0&&e.reportedParts?.tributada===undefined){parts.st=e.amount;evidence.push('Valor da operação atribuído a ST pelo conjunto cadastrado, sem somar base ST ao valor contábil.');}
 }
 if(e.reportedParts?.tributada===undefined&&parts.st===0){
  if(e.sourceKind==='efd-icms'&&pureExempt&&!hasOwn&&parts.isenta===0&&parts.outras===0){parts.isenta=e.amount;evidence.push('Valor do registro analítico com CST de isenção/não tributação, sem ICMS próprio.');}
  else if(e.sourceKind==='efd-icms'&&['50','51','90'].includes(cst)&&!hasOwn&&parts.isenta===0&&parts.outras===0){parts.outras=e.amount;evidence.push('Situação informada no registro analítico classificada em Outras, sem concluir incidência.');}
  else if(hasOwn&&!noOwnAllowed&&!stSituation&&(!cst||ownCsts.includes(cst))){
   if(e.base>0){
    // Only a detailed reduced-base situation can identify the whole operation
    // without equating its taxable value to its tax base.
    if(cst==='20'&&['item','documento','c190'].includes(e.granularity||'')&&e.exempt===0&&e.other===0){parts.tributada=e.amount;evidence.push('CST 20 declarado: valor da operação tributada separado da base reduzida.');}
    else {parts.tributada=e.base;evidence.push('Parcela tributada referenciada na base própria informada. Eventual diferença com o valor contábil fica explícita, sem rateio ou preenchimento residual.');}
   }
  }
 }
 if(parts.isenta>0&&hasOwn&&e.granularity!=='agregado'&&cst&&cst!=='20')add('isento-incompativel','Parcela isenta e tributação própria no mesmo registro','O registro detalhado reúne parcela isenta e tributação própria sob um único CST.','Conferir a segmentação; não tomar a maior parcela como classificação do total.');
 if([e.amount,e.base,e.tax,e.exempt,e.other,parts.tributada,parts.st].some(v=>v<0))add('negativo','Valor negativo preservado','Há estorno ou valor negativo na origem. A reconciliação mantém os sinais.');
 if(!e.taxConfirmed)add('coluna','Mapeamento do ICMS pendente','Crédito/débito não confirmado; este valor não conclui o tratamento fiscal.');
 if(parts.st!==0&&!stConfirmed){evidence.push('Valor ST informado permanece no original, aguardando confirmação; não integra a parcela ST confirmada.');parts.st=0;}
 const classified=parts.tributada+parts.isenta+parts.st+parts.outras;
 const rec:Reconciliation={level:e.granularity==='item'?'item':'registro',id:e.id,companyId:e.companyId,entryIds:[e.id],...reconcile(e.amount,classified,settings),reason:'Valor contábil menos a soma das parcelas tributada, isenta, ST e outras. Originais preservados.'};
 parts.revisar=e.amount-classified;
 if(rec.status!=='OK')add('reconciliacao','Diferença de reconciliação',`Diferença de ${(rec.difference/100).toFixed(2)} entre valor contábil e parcelas classificadas.`,'Investigar a origem da diferença, redução de base, parcelas ausentes e composição do valor contábil.',rec.status==='CRITICO'?'alta':'media');
 const activeParts=(['tributada','isenta','st','outras'] as const).filter(c=>parts[c]!==0);
 const classes={tributada:'TRIBUTADO',isenta:'ISENTO_NAO_TRIBUTADO',st:'SUBSTITUICAO_TRIBUTARIA',outras:'OUTRAS'} as const;
 let classification:MovementClass=activeParts.length>1?'MISTO':activeParts.length===1?classes[activeParts[0]]:'REVISAR';
 if(!master||manual.conflict||noOwnAllowed&&hasOwn||(e.reportedParts?.st??0)!==0&&!stConfirmed)classification='REVISAR';
 let sales=master?.impacta_faturamento||'CONDICIONAL',purchases=master?.impacta_compras||'CONDICIONAL';
 if(r){
  const incompatible=!!master&&(['TRANSFERENCIA','DEVOLUCAO','REMESSA','RETORNO','PERDA_BAIXA'].includes(master.grupo_cfop)||master.tratar_como_remessa)&&['compra','venda'].includes(r.operation);
  if(incompatible){add('natureza','Natureza oficial e exceção manual divergem','A regra manual '+r.id+' trata a operação como '+r.operation+', mas a descrição oficial indica '+master!.natureza_operacao+'. A exceção foi preservada.','Revisar a exceção; a operação não será incluída automaticamente em compras/faturamento.','alta');sales='CONDICIONAL';purchases='CONDICIONAL';}
  else{sales=r.operation==='venda'?'SIM':'NAO';purchases=r.operation==='compra'?'SIM':'NAO';}
 }
 if(manual.conflict||!master){sales='CONDICIONAL';purchases='CONDICIONAL';}
 return {cfop:e.cfop,descricao:master?.descricao_oficial||'CFOP sem versão aplicável',grupo:master?.grupo_cfop||'OUTRAS',movimento:e.direction,ambito:master?.ambito_operacao||'REVISAR',classificacao:classification,parts,credito_icms:e.direction==='saida'?'NAO_APLICAVEL':r?.credit==='vedar'?'NAO':master?.permissao_credito_icms||'REVISAR',debito_icms:e.direction==='entrada'?'NAO_APLICAVEL':r?.debit||master?.gera_debito_icms||'REVISAR',impacta_faturamento:sales,impacta_compras:purchases,regra_aplicada:r?.id||master?.id||'REVISAR',fundamento:r?.reference||master?.fundamento_legal||'Sem fundamento aplicável',version:master?.versao||0,manualRuleId:r?.id,shadowed:manual.shadowed,reconciliation:rec,findings,evidence};
}
export function hierarchyReconciliation(entries:(Entry&{cfopAnalysis?:CfopAnalysis})[],settings:AuditSettings,imports:ImportRecord[]=[]){
 const results:Reconciliation[]=entries.flatMap(e=>e.cfopAnalysis?[e.cfopAnalysis.reconciliation]:[]);
 for(const level of ['documento','cfop_cst_aliquota','empresa','competencia'] as const){
  const groups=new Map<string,typeof entries>();
  for(const e of entries){if(!e.cfopAnalysis)continue;const key=level==='documento'?(e.documentGroup||e.key||e.document):level==='cfop_cst_aliquota'?[e.cfop,e.fiscal?.cstIcms??'CST ausente',e.fiscal?.icmsRate??'Alíquota ausente'].join(':'):level==='empresa'?e.companyId:e.period;if(!key)continue;const id=level==='competencia'?key:e.companyId+':'+key;const group=groups.get(id)||[];group.push(e);groups.set(id,group);}
  for(const [id,group] of groups){const expected=group.reduce((s,e)=>s+e.amount,0),classified=group.reduce((s,e)=>s+e.cfopAnalysis!.reconciliation.classified,0),abs=group.reduce((s,e)=>s+e.cfopAnalysis!.reconciliation.absoluteDifference,0);results.push({level,id,companyId:level==='competencia'?undefined:group[0].companyId,entryIds:group.map(e=>e.id),...reconcile(expected,classified,settings,abs),reason:'Parcelas consolidadas a partir dos registros. Diferenças opostas não se anulam para determinar a prioridade.'});}
 }
 for(const e of entries){
  for(const child of (e.items||[]) as (Entry&{cfopAnalysis?:CfopAnalysis})[])if(child.cfopAnalysis)results.push(child.cfopAnalysis.reconciliation);
  if(e.items?.length)for(const metric of ['amount','base','tax'] as const){
   const observed=e.items.reduce((s,i)=>s+i[metric]-(metric==='amount'?(i.itemDiscount||0):0),0);
   results.push({level:'item',id:e.id+':C170:'+metric,companyId:e.companyId,entryIds:[e.id,...e.items.map(i=>i.id)],...reconcile(e[metric],observed,settings),reason:metric==='amount'?'C190 versus itens C170 líquidos de desconto. Despesas, ST, FCP-ST e IPI podem explicar diferenças; não houve rateio automático.':'C190 versus soma dos itens C170: '+(metric==='base'?'base própria':'ICMS próprio')+'.'});
  }
 }
 const documents=new Map<string,typeof entries>();for(const e of entries)if(e.documentSource){const key=e.documentGroup||e.companyId+':'+e.key;const g=documents.get(key)||[];g.push(e);documents.set(key,g);}
 for(const [id,group] of documents)for(const metric of ['amount','base','tax'] as const){const e=group[0],expected=metric==='amount'?e.documentAmount!:e.documentSource![metric],classified=group.reduce((s,e)=>s+e[metric],0);results.push({level:'documento',id:id+':C100:'+metric,companyId:e.companyId,entryIds:group.map(e=>e.id),...reconcile(expected,classified,settings),reason:'C100 linha '+e.documentSource!.line+' versus soma dos C190: '+(metric==='amount'?'valor da operação':metric==='base'?'base própria':'ICMS próprio')+'. A diferença é exibida sem alterar a fonte.'});}
 for(const imp of imports){const group=entries.filter(e=>e.importId===imp.id),assessment=imp.assessment;
  if(assessment)for(const side of ['credit','debit'] as const){const classified=group.filter(e=>e.direction===(side==='credit'?'entrada':'saida')&&e.taxConfirmed).reduce((s,e)=>s+e.tax,0),partial=!!imp.coverageWarnings?.length;results.push({level:'apuracao',id:imp.id+':E110:'+side,companyId:imp.companyId,entryIds:group.map(e=>e.id),...reconcile(assessment[side],classified,settings),...(partial?{status:'REVISAR' as const}:{}),reason:'E110 linha '+assessment.line+' versus ICMS dos C190 de '+(side==='credit'?'entrada':'saída')+'. '+(partial?'Há registros fora da cobertura; não é possível concluir a apuração.':'Conferência dos totais de operações próprias; ajustes e saldos não integram este comparativo.')});}
  else results.push({level:'apuracao',id:imp.id+':sem-apuracao',companyId:imp.companyId,entryIds:group.map(e=>e.id),expected:0,classified:0,difference:0,absoluteDifference:0,percent:null,status:'REVISAR',reason:'Apuração externa não fornecida. O saldo dos relatórios não representa a apuração final. Valores desta linha não são saldos apurados.'});
 }
 return results;
}
export function entryParts(e:Entry&{category?:string;cfopAnalysis?:CfopAnalysis}):Parts{
 if(e.cfopAnalysis)return e.cfopAnalysis.parts;
 return {tributada:0,isenta:0,st:0,outras:0,revisar:0,[e.category||'revisar']:e.amount} as Parts;
}
