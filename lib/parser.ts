import {parseEfd} from './efd-parser';
import type { Entry, TaxMode, ImportRecord } from './types';
import type {TaxFacts,FactField} from './tax-motor';
export const MAX_FILE_BYTES = 3_500_000;
export const MAX_ROWS = 12000;
export class ImportError extends Error { constructor(message: string, public lines: number[] = []) { super(message); } }
export function normalize(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,''); }
export function parseMoney(value: string): number {
  const clean=value.trim();
  if(!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2}$/.test(clean))throw new Error('Valor monetário inválido: "'+clean.slice(0,40)+'". Use 1.234,56.');
  const [whole,fraction]=clean.replace(/[-.]/g,'').split(',');
  const cents=Number(whole)*100+Number(fraction);
  if(!Number.isSafeInteger(cents)||cents>1_000_000_000_000_000)throw new Error('Valor fora do limite de precisão.');
  return clean.startsWith('-')?-cents:cents;
}
function split(line:string){return line.split(';').map(v=>v.trim().replace(/^"(.*)"$/,'$1'));}
export function validNfeKey(key:string){
  if(!/^\d{44}$/.test(key)||/^(\d)\1+$/.test(key))return false;
  let sum=0;
  for(let i=42,w=2;i>=0;i--,w=w===9?2:w+1)sum+=Number(key[i])*w;
  const check=11-sum%11;return Number(key[43])===(check>=10?0:check);
}
function fiscalFields(get:(name:string)=>string,headers:string[]):TaxFacts {
  const fiscal:TaxFacts={};
  const columns:[FactField,string[],RegExp|undefined][]=[
    ['ncm',['ncm'],/^\d{8}$/],['cest',['cest'],/^\d{7}$/],['cstIcms',['csticms'],/^\d{2,3}$/],
    ['csosn',['csosn'],/^\d{3}$/],['cbenef',['cbenef'],/^[A-Za-z0-9]{1,20}$/],
    ['productDescription',['descricaoproduto','descricaodoproduto'],undefined],['cnae',['cnae'],/^\d{7}$/],
    ['regime',['regimetributario'],undefined],['chainPosition',['posicaocadeia'],/^(substituto|substituido)$/],['finalidade',['finalidade'],undefined],['ufOrigem',['uforigem'],/^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO|EX)$/],
    ['ufDestino',['ufdestino'],/^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO|EX)$/]
  ];
  for(const [field,aliases,pattern] of columns){
    const available=aliases.filter(a=>headers.includes(a));
    if(available.length>1)throw new Error('Mais de uma coluna para '+field+'.');
    const value=get(available[0]||aliases[0]);
    if(!value)continue;
    if(value.length>300||pattern&&!pattern.test(value))throw new Error('Campo fiscal '+field+' inválido. Preserve os códigos completos, incluindo zeros iniciais.');
    fiscal[field]=value;
  }
  for(const [field,column] of [['icmsRate','aliquotaicms'],['mva','mva']] as const){
    const value=get(column);if(!value)continue;
    if(!/^\d+(?:,\d{1,4})?$/.test(value)||Number(value.replace(',','.'))>10000)throw new Error(column+': informe o percentual numérico com vírgula decimal, sem o símbolo %.');
    fiscal[field]=Number(value.replace(',','.'));
  }
  return fiscal;
}
const REQUIRED=['cfop','valorcontabil','basedecalculo','isentasounaotributadas','outras'];
function readHeader(line:string){
  const headers=split(line).map(normalize);
  if(REQUIRED.some(h=>!headers.includes(h))||!headers.some(h=>h==='impostocreditado'||h==='impostodebitado'))
    throw new ImportError('Layout não reconhecido. Informe CFOP, Valor Contábil, Base de Cálculo, Imposto Creditado e/ou Imposto Debitado, Isentas ou Não tributadas e Outras.');
  if(new Set(headers).size!==headers.length)throw new ImportError('Cabeçalhos duplicados.');
  return headers;
}
export function parseReport(buffer:Uint8Array,options:{companyId:string;period:string;importId:string;taxMode:TaxMode;filename:string}):{entries:Entry[];warnings:string[];encoding:string;sourceKind?:'consinco'|'efd-icms';sourceCnpj?:string;assessment?:ImportRecord['assessment'];coverageWarnings?:string[]}{
  if(buffer.byteLength>MAX_FILE_BYTES)throw new ImportError('Limite de 3,5 MB por arquivo.');
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(options.period))throw new ImportError('Competência inválida.');
  if(!/\.(txt|csv)$/i.test(options.filename))throw new ImportError('Envie um relatório TXT ou CSV separado por ponto e vírgula.');
  if(/(livroapu|operinteruf)/i.test(options.filename))throw new ImportError('Use ApuIcms como fonte principal. LivroApu e OperInterUF são complementares e não devem ser somados à apuração.');
  let text:string,encoding='UTF-8';
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{text=new TextDecoder('windows-1252').decode(buffer);encoding='Windows-1252';}
  if(text.includes('\0'))throw new ImportError('Conteúdo binário não aceito.');
  const lines=text.replace(/^\uFEFF/,'').split(/\r\n|\n|\r/);
  const headerIndex=lines.findIndex(l=>l.trim());
  if(headerIndex<0)throw new ImportError('Arquivo sem cabeçalho.');
  if(lines[headerIndex].startsWith('|0000|'))return parseEfd(lines,options,encoding);
  let headers=readHeader(lines[headerIndex]);
  const entries:Entry[]=[],errors:string[]=[],errorLines:number[]=[],warnings:string[]=[];
  for(let i=headerIndex+1;i<lines.length;i++){
    if(!lines[i].trim())continue;
    try{
      // Alguns relatórios separam entradas e saídas por novos cabeçalhos.
      if(normalize(split(lines[i])[0])==='cfop'){headers=readHeader(lines[i]);continue;}
      const values=split(lines[i]);
      if(values.length!==headers.length)throw new Error('Quantidade de colunas diferente do cabeçalho.');
      const get=(name:string)=>values[headers.indexOf(name)]||'';
      const cfop=get('cfop');
      if(!/^[123567]\d{3}$/.test(cfop))throw new Error('CFOP inválido; totais e linhas truncadas não são lançamentos.');
      const direction=Number(cfop[0])<4?'entrada':'saida';
      const expectedTax=direction==='entrada'?'impostocreditado':'impostodebitado';
      const nativeTax=headers.includes(expectedTax);
      const taxColumn=nativeTax?expectedTax:headers.includes('impostocreditado')?'impostocreditado':'impostodebitado';
      const tax=parseMoney(get(taxColumn));
      // Validar também a coluna que não compõe o valor selecionado.
      for(const name of ['impostocreditado','impostodebitado'])if(headers.includes(name)&&name!==taxColumn){
        if(parseMoney(get(name))!==0)throw new Error('Há imposto na coluna oposta ao sentido do CFOP. Revise o lançamento para não omitir valores.');
      }
      const numbers=['valorcontabil','basedecalculo','isentasounaotributadas','outras'].map(h=>parseMoney(get(h)));
      if([...numbers,tax].some(n=>n<0))warnings.push('Linha '+(i+1)+': valor negativo; revisar estorno/ajuste na origem.');
      const key=get('chavenfe');
      if(key&&!validNfeKey(key))throw new Error('Chave NF-e inválida (44 dígitos e dígito verificador).');
      const date=get('data');
      if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||!date.startsWith(options.period)))throw new Error('Data inválida ou fora da competência selecionada.');
      const counterpart=get('empresacontraparte');
      if(counterpart&&!/^0[1-6]$/.test(counterpart))throw new Error('Empresa contraparte deve ser um código de 01 a 06.');
      const taxConfirmed=nativeTax||options.taxMode==='por-direcao';
      const fiscal=fiscalFields(get,headers);
      const optionalMoney=(name:string)=>get(name)?parseMoney(get(name)):undefined;
      const stBase=optionalMoney('baseicmsst'),stTax=optionalMoney('valoricmsst'),taxable=optionalMoney('valortributado'),st=optionalMoney('valorst');
      if(stBase!==undefined)fiscal.baseSt=stBase/100;if(stTax!==undefined)fiscal.taxSt=stTax/100;
      const declared=normalize(get('tipomovimento'));if(declared&&!['entrada','saida'].includes(declared))throw new Error('TipoMovimento deve ser entrada ou saida.');
      const granularity=get('item')?'item':key||get('documento')?'documento':'agregado';
      const extra:Partial<Entry>={sourceKind:'consinco',granularity,...(declared?{directionDeclared:declared as Entry['direction']}:{ }),...(stBase===undefined?{}:{stBase}),...(stTax===undefined?{}:{stTax}),...(taxable===undefined&&st===undefined?{}:{reportedParts:{...(taxable===undefined?{}:{tributada:taxable}),...(st===undefined?{}:{st})}}),...(get('item')?{itemId:get('item')}:{})};
      entries.push({...extra,id:options.importId+':'+(i+1),importId:options.importId,companyId:options.companyId,period:options.period,line:i+1,raw:lines[i],...(Object.keys(fiscal).length?{fiscal}:{}),cfop,direction,amount:numbers[0],base:numbers[1],tax,exempt:numbers[2],other:numbers[3],taxConfirmed,taxLabel:taxColumn==='impostocreditado'?'Imposto Creditado':'Imposto Debitado',taxMapping:nativeTax?'cabecalho':options.taxMode==='por-direcao'?'confirmacao':'pendente',...(key?{key}:{}),...(date?{date}:{}),...(get('documento')?{document:get('documento')}:{}),...(counterpart?{counterpart}:{})});
      if(entries.length>MAX_ROWS)throw new ImportError('Limite de '+MAX_ROWS+' linhas por relatório.');
    }catch(e){if(e instanceof ImportError)throw e;errorLines.push(i+1);errors.push('Linha '+(i+1)+': '+(e as Error).message);}
  }
  if(errors.length)throw new ImportError(errors.length+' linha(s) inválida(s). Nenhuma linha será importada. '+errors.slice(0,8).join(' '),errorLines);
  if(!entries.length)warnings.push('Arquivo contém somente cabeçalho. Necessária declaração de ausência de movimento para esta empresa e competência.');
  if(entries.some(e=>!e.taxConfirmed))warnings.push('O rótulo do imposto não corresponde ao sentido de algumas linhas. Crédito/débito e saldo ficam pendentes até confirmar o mapeamento.');
  if(entries.some(e=>!e.key))warnings.push('Fonte resumida/sem chave: auditoria por CFOP disponível; cruzamento documental depende do relatório detalhado.');
  return {entries,warnings:[...new Set(warnings)],encoding,sourceKind:'consinco'};
}
