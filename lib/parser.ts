import type { Entry, TaxMode } from './types';
export const MAX_FILE_BYTES = 3_500_000;
export const MAX_ROWS = 12000;
export class ImportError extends Error { constructor(message: string, public lines: number[] = []) { super(message); } }
export function normalize(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,''); }
export function parseMoney(value: string): number {
  const clean = value.trim();
  if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2}$/.test(clean)) throw new Error(`Valor monetário inválido: "${clean.slice(0,40)}". Use 1.234,56.`);
  const negative = clean.startsWith('-');
  const [whole, fraction] = clean.replace(/[-.]/g,'').split(',');
  const cents = Number(whole)*100 + Number(fraction);
  if (!Number.isSafeInteger(cents) || cents > 1_000_000_000_000_000) throw new Error('Valor fora do limite de precisão.');
  return negative ? -cents : cents;
}
function split(line: string) { return line.split(';').map(v => v.trim().replace(/^"(.*)"$/,'$1')); }
export function validNfeKey(key: string) {
  if (!/^\d{44}$/.test(key) || /^(\d)\1+$/.test(key)) return false;
  let sum = 0;
  for (let i=42, weight=2; i>=0; i--,weight=weight===9?2:weight+1) sum += Number(key[i])*weight;
  const check = 11-sum%11;
  return Number(key[43]) === (check>=10 ? 0 : check);
}
export function parseReport(buffer: Uint8Array, options: {companyId:string; period:string; importId:string; taxMode:TaxMode; filename:string}) {
  if (buffer.byteLength > MAX_FILE_BYTES) throw new ImportError('Limite de 3,5 MB por arquivo. Divida o relatório detalhado antes de importar.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(options.period)) throw new ImportError('Competência inválida.');
  if (!/\.(txt|csv)$/i.test(options.filename)) throw new ImportError('Envie um relatório TXT ou CSV separado por ponto e vírgula.');
  if (/(livroapu|operinteruf)/i.test(options.filename)) throw new ImportError('Use ApuIcms como fonte principal. LivroApu e OperInterUF são complementares e não devem ser somados à apuração.');
  let text: string;
  try { text = new TextDecoder('utf-8',{fatal:true}).decode(buffer); }
  catch { text = new TextDecoder('windows-1252').decode(buffer); }
  if (text.includes('\0')) throw new ImportError('Conteúdo binário não aceito.');
  const lines = text.replace(/^\uFEFF/,'').split(/\r\n|\n|\r/);
  const headerIndex = lines.findIndex(l=>l.trim());
  if (headerIndex<0) throw new ImportError('Arquivo sem cabeçalho.');
  const headers = split(lines[headerIndex]).map(normalize);
  const expected = ['cfop','valorcontabil','basedecalculo','impostocreditado','isentasounaotributadas','outras'];
  if (expected.some(h=>!headers.includes(h))) throw new ImportError('Layout não reconhecido. Esperado: CFOP;Valor Contábil;Base de Cálculo;Imposto Creditado;Isentas ou Não tributadas;Outras.');
  if (new Set(headers).size!==headers.length) throw new ImportError('Cabeçalhos duplicados.');
  const entries: Entry[]=[]; const errors: string[]=[]; const errorLines: number[]=[];
  const warnings: string[]=[];
  for (let i=headerIndex+1; i<lines.length; i++) {
    if (!lines[i].trim()) continue;
    try {
      const values=split(lines[i]);
      if (values.length!==headers.length) throw new Error('Quantidade de colunas diferente do cabeçalho.');
      const get=(name:string)=>values[headers.indexOf(name)] || '';
      const cfop=get('cfop');
      if (!/^[123567]\d{3}$/.test(cfop)) throw new Error('CFOP inválido; totais e linhas truncadas não são lançamentos.');
      const key=get('chavenfe');
      if (key && !validNfeKey(key)) throw new Error('Chave NF-e inválida (44 dígitos e dígito verificador).');
      const date=get('data');
      if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date || !date.startsWith(options.period))) throw new Error('Data inválida ou fora da competência selecionada.');
      const counterpart=get('empresacontraparte');
      if (counterpart && !/^0[1-6]$/.test(counterpart)) throw new Error('Empresa contraparte deve ser um código de 01 a 06.');
      const numbers=expected.slice(1).map(h=>parseMoney(get(h)));
      if (numbers.some(n=>n<0)) warnings.push(`Linha ${i+1}: valor negativo; revisar estorno/ajuste na origem.`);
      const direction=Number(cfop[0])<4?'entrada':'saida';
      entries.push({id:`${options.importId}:${i+1}`,importId:options.importId,companyId:options.companyId,period:options.period,line:i+1,raw:lines[i],cfop,direction,amount:numbers[0],base:numbers[1],tax:numbers[2],exempt:numbers[3],other:numbers[4],taxConfirmed:direction==='entrada'||options.taxMode==='por-direcao',...(key?{key}:{}),...(date?{date}:{}),...(get('documento')?{document:get('documento')}:{}),...(counterpart?{counterpart}:{})});
      if(entries.length>MAX_ROWS) throw new ImportError(`Limite de ${MAX_ROWS} linhas por relatório.`);
    } catch(e) { if(e instanceof ImportError) throw e; errorLines.push(i+1); errors.push(`Linha ${i+1}: ${(e as Error).message}`); }
  }
  if(errors.length) throw new ImportError(`${errors.length} linha(s) inválida(s). Nenhuma linha será importada. ${errors.slice(0,8).join(' ')}`,errorLines);
  if(!entries.length) warnings.push('Arquivo contém somente cabeçalho. Confirme explicitamente que a empresa não teve movimento.');
  if(entries.some(e=>e.direction==='saida'&&!e.taxConfirmed)) warnings.push('Imposto nas saídas com rótulo “Imposto Creditado”: débito e saldo permanecerão pendentes até confirmar o significado da coluna.');
  if(entries.some(e=>!e.key)) warnings.push('Fonte resumida/sem chave: rastreabilidade até a linha do arquivo; cruzamento de NF-e indisponível para essas linhas.');
  return {entries,warnings:[...new Set(warnings)],encoding:text===new TextDecoder().decode(buffer)?'UTF-8':'Windows-1252'};
}
