import official from './data/cfop-official.json';
import type {Company,Entry,Rule} from './types';
export const CFOP_GROUPS=['COMPRA','VENDA','TRANSFERENCIA','DEVOLUCAO','SUBSTITUICAO_TRIBUTARIA','ATIVO_IMOBILIZADO','USO_CONSUMO','ENERGIA','COMUNICACAO','TRANSPORTE','IMPORTACAO','EXPORTACAO','INDUSTRIALIZACAO','BONIFICACAO','CONSIGNACAO','REMESSA','RETORNO','ARMAZEM_DEPOSITO','DEMONSTRACAO','PERDA_BAIXA','OUTRAS'] as const;
export type CfopGroup=typeof CFOP_GROUPS[number];
export type FiscalPermission='SIM'|'NAO'|'CONDICIONAL'|'REVISAR';
export type Impact='SIM'|'NAO'|'CONDICIONAL';
export type CfopMasterRule={
 id:string;cfop:string;descricao_oficial:string;grupo_cfop:CfopGroup;tipo_movimento:'entrada'|'saida';ambito_operacao:'INTERNO'|'INTERESTADUAL'|'EXTERIOR';natureza_operacao:string;
 empresa:string;uf_aplicacao:string;vigencia_inicial:string;vigencia_final:string|null;classificacao_valor_contabil:'POR_LANCAMENTO';
 permissao_credito_icms:FiscalPermission;gera_debito_icms:FiscalPermission;alertar_base_sem_credito:boolean;
 tratar_como_faturamento:boolean;tratar_como_compra:boolean;tratar_como_transferencia:boolean;tratar_como_devolucao:boolean;tratar_como_remessa:boolean;tratar_como_retorno:boolean;
 impacta_faturamento:Impact;impacta_compras:Impact;motivo_condicoes:string;fundamento_legal:string;fonte:string;prioridade:number;ativo:boolean;versao:number;seed_version:string;source_hash:string;data_fonte:string;grupo_oficial:string;
};
const normalized=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function cfopGroup(description:string,cfop:string):CfopGroup{
 const d=normalized(description);
 if(/^(devolucao|anulacao)|titulo de devolucao/.test(d))return 'DEVOLUCAO';
 if(/^transferencia/.test(d))return 'TRANSFERENCIA';
 if(/perda|roubo|deterioracao|baixa de estoque|baixa de bem/.test(d))return 'PERDA_BAIXA';
 if(/^retorno|retorno simbolico/.test(d))return 'RETORNO';
 if(/bonificacao|doacao|brinde/.test(d))return 'BONIFICACAO';
 if(/demonstracao|mostruario/.test(d))return 'DEMONSTRACAO';
 if(/armazem|deposito fechado|deposito temporario/.test(d))return 'ARMAZEM_DEPOSITO';
 if(/consignacao/.test(d))return 'CONSIGNACAO';
 if(/^remessa/.test(d))return 'REMESSA';
 if(/substituicao tributaria/.test(d))return 'SUBSTITUICAO_TRIBUTARIA';
 if(/ativo imobilizado/.test(d))return 'ATIVO_IMOBILIZADO';
 if(/uso ou consumo|uso e consumo/.test(d))return 'USO_CONSUMO';
 if(/energia eletrica/.test(d))return 'ENERGIA';
 if(/comunicacao/.test(d))return 'COMUNICACAO';
 if(/transporte/.test(d))return 'TRANSPORTE';
 if(/^industrializacao/.test(d))return 'INDUSTRIALIZACAO';
 if(cfop[0]==='3'&&/^compra/.test(d))return 'IMPORTACAO';
 if(cfop[0]==='7'&&/^venda/.test(d))return 'EXPORTACAO';
 if(/^compra/.test(d))return 'COMPRA';
 if(/^venda/.test(d))return 'VENDA';
 return 'OUTRAS';
}
export const CFOP_SOURCE=official.metadata;
export function buildCfopSeed():CfopMasterRule[]{
 return official.records.map(r=>{
  const d=normalized(r.description),group=cfopGroup(r.description,r.cfop),incoming=+r.cfop[0]<4;
  const transfer=group==='TRANSFERENCIA',returns=group==='DEVOLUCAO',shipment=/^remessa/.test(d),back=group==='RETORNO';
  const sale=/^venda/.test(d)&&!['ATIVO_IMOBILIZADO','USO_CONSUMO'].includes(group),purchase=/^compra/.test(d);
  const special=/simples faturamento|fixacao de preco|ajuste|ressarcimento|credito/.test(d);
  return {id:'confaz:'+r.cfop+':'+r.start,cfop:r.cfop,descricao_oficial:r.description,grupo_cfop:group,tipo_movimento:incoming?'entrada':'saida',ambito_operacao:['1','5'].includes(r.cfop[0])?'INTERNO':['2','6'].includes(r.cfop[0])?'INTERESTADUAL':'EXTERIOR',natureza_operacao:transfer?'transferencia':returns?'devolucao':shipment?'remessa':back?'retorno':purchase?'compra':sale?'venda':group.toLowerCase(),empresa:'',uf_aplicacao:'',vigencia_inicial:r.start,vigencia_final:r.end,classificacao_valor_contabil:'POR_LANCAMENTO',permissao_credito_icms:group==='OUTRAS'?'REVISAR':'CONDICIONAL',gera_debito_icms:group==='OUTRAS'?'REVISAR':'CONDICIONAL',alertar_base_sem_credito:incoming,
   tratar_como_faturamento:!incoming&&sale&&!special,tratar_como_compra:incoming&&purchase&&!special,tratar_como_transferencia:transfer,tratar_como_devolucao:returns,tratar_como_remessa:shipment,tratar_como_retorno:back,
   impacta_faturamento:!incoming&&sale?(special?'CONDICIONAL':'SIM'):'NAO',impacta_compras:incoming&&purchase?(special?'CONDICIONAL':'SIM'):'NAO',
   motivo_condicoes:'A natureza foi identificada pela descrição oficial. Crédito e débito dependem do conjunto de evidências fiscais e de exceções aplicáveis; o CFOP não concede direito ao crédito. A classificação é feita por lançamento, preservando parcelas mistas.',fundamento_legal:official.metadata.legalReference+'; '+r.reference,fonte:official.metadata.source,prioridade:100,ativo:true,versao:1,seed_version:official.metadata.version,source_hash:official.metadata.sourceHash,data_fonte:official.metadata.checkedAt,grupo_oficial:r.officialGroup};
 });
}
export function masterFor(e:Pick<Entry,'cfop'|'period'|'date'>,masters:CfopMasterRule[]){
 const start=e.date||e.period+'-01';const end=e.date||new Date(Date.UTC(+e.period.slice(0,4),+e.period.slice(5,7),0)).toISOString().slice(0,10);
 const found=masters.filter(r=>r.ativo&&r.cfop===e.cfop&&r.vigencia_inicial<=end&&(!r.vigencia_final||r.vigencia_final>=start));
 return found.length===1&&found[0].vigencia_inicial<=start&&(!found[0].vigencia_final||found[0].vigencia_final>=end)?found[0]:undefined;
}
export function manualPriority(r:Rule){return r.companyId&&r.uf?600:r.companyId?500:r.uf?400:300;}
export function resolveManual(e:Entry,company:Company|undefined,rules:Rule[]){
 const candidates=rules.filter(r=>r.active&&r.cfop===e.cfop&&(!r.companyId||r.companyId===e.companyId)&&(!r.uf||r.uf===company?.uf)&&r.start<=e.period&&(!r.end||r.end>=e.period));
 const priority=Math.max(0,...candidates.map(manualPriority)),top=candidates.filter(r=>manualPriority(r)===priority);
 return {rule:top.length===1?top[0]:undefined,conflict:top.length>1,shadowed:candidates.filter(r=>manualPriority(r)<priority).map(r=>r.id)};
}
export function catalogStats(rules:CfopMasterRule[],asOf=CFOP_SOURCE.checkedAt){
 const active=rules.filter(r=>r.ativo&&r.vigencia_inicial<=asOf&&(!r.vigencia_final||r.vigencia_final>=asOf));
 return {total:active.length,versions:rules.length,conditional:active.filter(r=>r.permissao_credito_icms==='CONDICIONAL'||r.gera_debito_icms==='CONDICIONAL').length,review:active.filter(r=>r.permissao_credito_icms==='REVISAR'||r.gera_debito_icms==='REVISAR').length,byGroup:Object.fromEntries(CFOP_GROUPS.map(g=>[g,active.filter(r=>r.grupo_cfop===g).length])),source:CFOP_SOURCE};
}
