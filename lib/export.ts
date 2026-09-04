import type {AppData} from './types';
import {totals} from './audit';
import {money} from './format';
import {cfopScope} from './cfop';
const safe=(value:unknown)=>typeof value==='string'&&/^[=+\-@\t\r]/.test(value)?"'"+value:value;
export async function excelExport(data:AppData,companyId='all') {
  const {default:ExcelJS}=await import('exceljs');
  const book=new ExcelJS.Workbook();book.creator='Mega G — Auditor Fiscal';
  const snapshot=data.snapshot;
  const entries=(snapshot?.entries||[]).filter(e=>companyId==='all'||e.companyId===companyId);
  const ids=new Set(entries.map(e=>e.id));
  const alerts=(snapshot?.alerts||[]).filter(a=>companyId==='all'||a.companyId===companyId);
  const company=(id:string)=>(snapshot?.companies||data.companies).find(c=>c.id===id)?.name||id;
  function sheet(name:string,headers:string[],rows:unknown[][]) {
    const ws=book.addWorksheet(name);
    ws.addRow(headers);
    for(const row of rows) ws.addRow(row.map(safe));
    ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
    ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF153A35'}};
    ws.views=[{state:'frozen',ySplit:1}];
    ws.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,rows.length+1),column:headers.length}};
    ws.columns.forEach((c,i)=>{c.width=i===headers.length-1?65:24;});
    return ws;
  }
  const t=totals(entries);
  sheet('Resumo',['Indicador','Valor'],[
    ['Ambiente',data.demo?'DEMONSTRAÇÃO — DADOS FICTÍCIOS':'DADOS REAIS'],
    ['Competência',snapshot?.period||'Sem processamento'],['Empresa',companyId==='all'?'Grupo consolidado':company(companyId)],
    ['Processamento',snapshot?.id||'Não processado'],['Desatualizado',data.stale?'SIM — reprocessar':'Não'],
    ['Entradas (inclui outras operações)',t.incoming/100],['Saídas (inclui outras operações)',t.outgoing/100],
    ['Compras classificadas por regra',t.purchases/100],['Vendas classificadas por regra',t.sales/100],
    ['ICMS crédito informado',t.credit/100],['ICMS débito confirmado',t.debit/100],
    ['Saldo dos relatórios (não é apuração final)',t.complete?t.balance/100:'Pendente: mapeamento do ICMS'],
    ['Limitação','Sem saldos anteriores, ajustes ou outros créditos/débitos não informados. Totais consolidados brutos, sem eliminação intercompanhia.'],
    ['Alertas',alerts.length]
  ]);
  const ws=sheet('Lançamentos',['Empresa','Competência','CFOP','Direção','Valor contábil (R$)','Base (R$)','ICMS informado (R$)','Isentas (R$)','Outras (R$)','Mapeamento do ICMS confirmado','Classificação por regra','Operação','Status','Importação','Linha','NF-e','Documento','Regra','Motivo / linha original'],entries.map(e=>[company(e.companyId),e.period,e.cfop,e.direction,e.amount/100,e.base/100,e.tax/100,e.exempt/100,e.other/100,e.taxConfirmed?'Sim':'Não',e.category,e.operation||'Revisar',e.status,e.importId,e.line,e.key||'',e.document||'',e.ruleId||'',e.reasons.join(' | ')+' | '+e.raw]));
  [5,6,7,8,9].forEach(i=>ws.getColumn(i).numFmt='#,##0.00');
  sheet('Auditoria',['Prioridade','Empresa','Alerta','Valor ICMS observado (R$)','Lançamento','Explicação'],alerts.map(a=>[a.priority,a.companyId?company(a.companyId):'Grupo',a.title,(a.amount??0)/100,a.entryId||'',a.reason]));
  sheet('Transferências',['Chave NF-e','Status','Valor contábil (R$)','Lançamentos','Motivo'],(snapshot?.transfers||[]).filter(t=>t.entryIds.some(id=>ids.has(id))).map(t=>[t.key||'Sem chave',t.status,t.amount/100,t.entryIds.join(', '),t.reason]));
  sheet('Transferências por CFOP',['Empresa','CFOP','Direção','Valor (R$)','ICMS observado (R$)','Status','Lançamentos','Natureza','Abrangência pelo CFOP','Conferência das UFs','Referência','Motivos'],(snapshot?.transferCfops||[]).filter(c=>companyId==='all'||c.companyId===companyId).map(c=>[company(c.companyId),c.cfop,c.direction,c.amount/100,c.tax/100,c.status,c.entryIds.join(', '),c.description,cfopScope(c.cfop)?.label||'',c.ufCheck?c.ufCheck.status+': '+c.ufCheck.reason:'Não registrada',c.reference,c.reasons.join(' | ')]));
  sheet('Sem movimento',['Empresa','Competência','Responsável','Declarado em','Motivo'],(snapshot?.declarations||[]).filter(d=>companyId==='all'||d.companyId===companyId).map(d=>[company(d.companyId),d.period,d.declaredBy,d.declaredAt,d.reason]));
  sheet('Regras do processamento',['CFOP','Empresa','UF','Início','Fim','Categoria','Operação','Crédito','Crédito esperado','Ativa','Pares CFOP permitidos','Fundamento','Motivo'],(snapshot?.rules||[]).map(r=>[r.cfop,r.companyId||'Todas',r.uf||'Todas',r.start,r.end||'',r.category,r.operation,r.credit,r.expectCredit?'Sim':'Não',r.active?'Sim':'Não',(r.pairedCfops||[]).join(', '),r.reference,r.reason]));
  sheet('Motor - evidências',['Lançamento','Empresa','CFOP','Regra','Versão','Resultado','Prioridade','Campos ausentes','Evidências informadas','Fundamento','Pacote','Origem do critério','Explicação'],entries.flatMap(e=>(e.taxFindings||[]).map(f=>[e.id,company(e.companyId),e.cfop,f.title,f.version,f.status,f.priority,f.missing.join(', '),JSON.stringify(f.evidence),f.reference,f.packageId,f.sourcePath,f.reason])));
  sheet('Motor - versões',['ID','Referência','Módulo','Versão','Situação','Vigência inicial','Vigência final','Responsável','Fundamento','Condições','Verificações','Pacote','Origem','Justificativa'],(snapshot?.taxRules||[]).map(r=>[r.id,r.title,r.domain,r.version,r.status,r.start,r.end,r.validatedBy||r.updatedBy,r.reference,JSON.stringify(r.conditions),JSON.stringify(r.checks),r.packageId,r.sourcePath,r.reason]));
  sheet('Motor - pacotes',['Nome','Versão','Arquivo','SHA-256','Referências','Importado em'],(snapshot?.taxPackages||[]).map(p=>[p.name,p.version,p.filename,p.hash,p.ruleCount,p.importedAt]));
  sheet('Fontes',['Empresa','Competência','Arquivo','SHA-256','Linhas','Importado em','Mapeamento de imposto','Avisos'],(snapshot?.imports||[]).filter(i=>companyId==='all'||i.companyId===companyId).map(i=>[company(i.companyId),i.period,i.filename,i.hash,i.rowCount,i.uploadedAt,i.taxMode,i.warnings.join(' | ')]));
  return book.xlsx.writeBuffer();
}
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function reportExport(data:AppData,companyId='all') {
  const s=data.snapshot, entries=(s?.entries||[]).filter(e=>companyId==='all'||e.companyId===companyId),t=totals(entries);
  const alerts=(s?.alerts||[]).filter(a=>companyId==='all'||a.companyId===companyId);
  return '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Mega G — Relatório de auditoria</title><style>body{font:15px/1.6 Arial;margin:48px;color:#162b2b}h1{border-bottom:3px solid #258570;padding-bottom:18px}table{border-collapse:collapse;width:100%;font-size:12px}td,th{padding:10px;text-align:left;border-bottom:1px solid #ddd;vertical-align:top;overflow-wrap:anywhere}.notice{background:#fff3cf;padding:15px}button{padding:12px} @media print{button{display:none}body{margin:15mm}tr{break-inside:avoid}}</style><h1>Mega G — Auditor Fiscal</h1><p class="notice">'+(data.demo?'DEMONSTRAÇÃO — DADOS FICTÍCIOS':'DOCUMENTO CONFIDENCIAL — DADOS REAIS')+(data.stale?' • DESATUALIZADO: REPROCESSAR':'')+'</p><p>Competência: '+esc(s?.period)+' • Escopo: '+esc(companyId==='all'?'Grupo consolidado':(s?.companies||data.companies).find(c=>c.id===companyId)?.name)+'<br>Processado em: '+esc(s?.processedAt)+'<br>Versão: '+esc(s?.id)+'</p><h2>Resumo do período</h2><p>'+alerts.length+' alertas para revisão. '+alerts.filter(a=>a.priority==='alta').length+' com prioridade alta. As conclusões são condicionadas às regras cadastradas e à cobertura das fontes.</p><p>Entradas: '+money(t.incoming)+' • Saídas: '+money(t.outgoing)+'<br>Crédito informado: '+money(t.credit)+' • Débito confirmado: '+money(t.debit)+'<br>Saldo dos relatórios: '+(t.complete?money(t.balance):'Pendente de confirmação do mapeamento do ICMS')+'</p><p>Não inclui saldos anteriores ou ajustes não fornecidos. Consolidação bruta, sem eliminação de transferências. Ausência de regra resulta em Revisar. Classificações são configuradas por CFOP e podem exigir detalhe por item.</p><h2>Central de auditoria</h2><table><thead><tr><th>Prioridade</th><th>Alerta</th><th>Evidência e motivo</th></tr></thead><tbody>'+alerts.map(a=>'<tr><td>'+esc(a.priority)+'</td><td>'+esc(a.title)+'</td><td>'+esc(a.reason)+(a.entryId?'<br>Origem: '+esc(a.entryId):'')+'</td></tr>').join('')+'</tbody></table><h2>Transferências por CFOP</h2><table><tr><th>Empresa / CFOP</th><th>Valor</th><th>Status e motivos</th></tr>'+ (s?.transferCfops||[]).filter(c=>companyId==='all'||c.companyId===companyId).map(c=>'<tr><td>'+esc(c.companyId)+' / '+esc(c.cfop)+'</td><td>'+money(c.amount)+'</td><td>'+esc(c.status)+'<br>'+esc(cfopScope(c.cfop)?.label)+'<br>'+esc(c.ufCheck?c.ufCheck.status+': '+c.ufCheck.reason:'')+'<br>'+esc(c.reasons.join(' | '))+'<br>Origens: '+esc(c.entryIds.join(', '))+'</td></tr>').join('')+'</table><h2>Ausência de movimento declarada</h2>'+ (s?.declarations||[]).filter(d=>companyId==='all'||d.companyId===companyId).map(d=>'<p>'+esc(d.companyId)+' • '+esc(d.period)+' • '+esc(d.reason)+'<br>'+esc(d.declaredBy)+' • '+esc(d.declaredAt)+'</p>').join('')+'<h2>Lançamentos e rastreabilidade</h2><table><tr><th>Empresa / CFOP</th><th>Valor</th><th>Origem</th></tr>'+entries.map(e=>'<tr><td>'+esc(e.companyId)+' / '+esc(e.cfop)+'</td><td>'+money(e.amount)+'</td><td>'+esc(e.importId)+' • linha '+e.line+'<br>'+esc(e.raw)+'</td></tr>').join('')+'</table><h2>Critérios utilizados</h2>'+ (s?.rules||[]).map(r=>'<p><b>CFOP '+esc(r.cfop)+'</b> • '+esc(r.reference)+'<br>'+esc(r.reason)+'</p>').join('')+'<h2>Motor tributário: evidências e versões</h2>'+entries.flatMap(e=>(e.taxFindings||[]).map(f=>'<p><b>'+esc(f.title)+' · v'+f.version+' · '+esc(f.status)+'</b><br>Origem: '+esc(e.importId)+' · linha '+e.line+'<br>'+esc(f.reason)+'<br>Evidências: '+esc(JSON.stringify(f.evidence))+'</p>')).join('')+'<h2>Referências do motor no processamento</h2>'+(s?.taxRules||[]).map(r=>'<p>'+esc(r.title)+' · v'+r.version+' · '+esc(r.status)+'<br>'+esc(r.reference)+'<br>Critérios: '+esc(JSON.stringify({conditions:r.conditions,requiredFields:r.requiredFields,checks:r.checks}))+'</p>').join('')+'<h2>Fontes preservadas</h2>'+ (s?.imports||[]).map(i=>'<p>'+esc(i.filename)+' • '+i.rowCount+' linhas<br>SHA-256: '+esc(i.hash)+'</p>').join('')+'</html>';
}
