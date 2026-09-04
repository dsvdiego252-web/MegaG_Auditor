import type {Entry,ImportRecord,TaxMode} from './types';
import {ImportError,validNfeKey,MAX_ROWS} from './parser';
import type {TaxFacts} from './tax-motor';
export const EFD_GUIDE='https://sped.rfb.gov.br/arquivo/download/8112';
function amount(v:string|undefined,required=false){
 if(!v&&!required)return 0;
 if(!v||! /^-?\d+(?:,\d{1,2})?$/.test(v))throw new Error('Valor monetário da EFD inválido.');
 const [whole,fraction='']=v.replace('-','').split(','),n=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(n)||n>1e15)throw new Error('Valor fora do limite de precisão.');
 return v.startsWith('-')?-n:n;
}
function date(v:string){if(!/^\d{8}$/.test(v))throw new Error('Data EFD inválida.');const s=v.slice(4)+'-'+v.slice(2,4)+'-'+v.slice(0,2);if(Number.isNaN(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw new Error('Data EFD inválida.');return s;}
function rate(v:string){if(!v)return undefined;if(!/^\d+(?:,\d{1,4})?$/.test(v)||Number(v.replace(',','.'))>100)throw new Error('Alíquota ICMS inválida.');return Number(v.replace(',','.'));}
const grain=(e:Entry)=>[e.cfop,e.fiscal?.cstIcms,e.fiscal?.icmsRate??'ausente'].join(':');
export function parseEfd(lines:string[],options:{companyId:string;period:string;importId:string;taxMode:TaxMode;filename:string},encoding:string){
 const headerIndex=lines.findIndex(l=>l.trim()),first=lines[headerIndex].split('|');
 if(lines.some(l=>/^\|0(110|140)\|/.test(l)))throw new ImportError('Este arquivo é EFD-Contribuições. A importação de PIS/COFINS será integrada em outra fase; use EFD ICMS/IPI ou Consinco para ICMS.');
 if(first[1]!=='0000'||!/^0(18|19|20)$/.test(first[2]||''))throw new ImportError('Leiaute EFD ICMS/IPI não suportado. Esta versão lê os leiautes 018 a 020; outros exigem atualização do adaptador.');
 let start:string,end:string;try{start=date(first[4]);end=date(first[5]);}catch{throw new ImportError('Cabeçalho 0000 da EFD ICMS/IPI inválido.');}
 if(!start.startsWith(options.period)||!end.startsWith(options.period)||start>end)throw new ImportError('O período do registro 0000 não corresponde à competência selecionada.');
 if(options.period>='2027-01')throw new ImportError('EFD a partir de 2027 exige o adaptador do leiaute 021. O original não foi importado parcialmente.');
 const sourceCnpj=first[7];if(!/^\d{14}$/.test(sourceCnpj||''))throw new ImportError('CNPJ do registro 0000 inválido.');
 const entries:Entry[]=[],warnings:string[]=[],unsupported=new Set<string>(),products=new Map<string,TaxFacts>(),participants=new Map<string,string>();
 let document:{raw:string;line:number;v:string[];rows:Entry[];items:Entry[]}|undefined,assessment:ImportRecord['assessment'],assessmentPeriod=false;
 let totalItems=0,hasClose=false;
 function finish(){if(!document)return;const d=document;document=undefined;
  const cancelled=['02','03','04','05'].includes(d.v[6]);
  if(cancelled){if(d.rows.length||d.items.length)throw new Error('Documento cancelado/denegado/inutilizado possui registros de valores.');return;}
  if(!d.rows.length)throw new Error('C100 linha '+d.line+' sem C190. Importe uma EFD com os registros analíticos, sem omitir documentos.');
  const keys=new Set<string>();for(const e of d.rows){if(keys.has(grain(e)))throw new Error('C190 duplicado na combinação CST + CFOP + alíquota do documento '+d.v[8]+'.');keys.add(grain(e));}
  for(const item of d.items){const target=d.rows.find(e=>grain(e)===grain(item));if(!target)throw new Error('C170 linha '+item.line+' sem C190 correspondente.');(target.items??=[]).push(item);}
  entries.push(...d.rows);
 }
 for(let i=headerIndex+1;i<lines.length;i++){
  const raw=lines[i];if(!raw.trim())continue;
  if(!raw.startsWith('|')||!raw.endsWith('|'))throw new ImportError('Linha '+(i+1)+': registro EFD sem delimitadores completos.',[i+1]);
  const v=raw.split('|'),reg=v[1];
  try{
   if(document&&(reg==='C100'||!reg.startsWith('C1')))finish();
   if(reg==='9999'){if(hasClose||lines.slice(i+1).some(l=>l.trim()))throw new Error('Conteúdo após o fechamento 9999.');hasClose=true;}
   if(reg==='0000')throw new Error('Mais de um estabelecimento/arquivo 0000. Envie uma EFD por empresa.');
   if(reg==='0200'){if(products.has(v[2]))throw new Error('Cadastro 0200 duplicado.');products.set(v[2],{productDescription:v[3],...(v[8]?{ncm:v[8]}:{}),...(v[13]?{cest:v[13]}:{})});}
   if(reg==='0150'&&v[5])participants.set(v[2],v[5]);
   if(reg==='C100'){
    if(!['0','1'].includes(v[2])||!['00','01','02','03','04','05','06','07','08'].includes(v[6]))throw new Error('Indicador de operação ou situação C100 inválido.');
    if(v[9]&&!validNfeKey(v[9]))throw new Error('Chave NF-e C100 inválida.');
    document={raw,line:i+1,v,rows:[],items:[]};
   }
   if(reg==='C170'||reg==='C190'){
    if(!document)throw new Error(reg+' sem C100 pai.');
    const d=document,cfop=v[reg==='C170'?11:3],cst=v[reg==='C170'?10:2],aliq=rate(v[reg==='C170'?14:4]);
    if(!/^[123567]\d{3}$/.test(cfop)||!/^\d{3}$/.test(cst))throw new Error('CFOP ou CST inválido em '+reg+'.');
    const fiscal:TaxFacts={...(reg==='C170'?products.get(v[3])||{}:{}),cstIcms:cst,...(aliq===undefined?{}:{icmsRate:aliq})};
    if(reg==='C170'&&v[4])fiscal.productDescription=v[4];
    fiscal.baseSt=amount(v[reg==='C170'?16:8])/100;fiscal.taxSt=amount(v[reg==='C170'?18:9])/100;
    const operationDate=d.v[11]?date(d.v[11]):d.v[10]?date(d.v[10]):undefined;
    const e:Entry={id:options.importId+':'+(i+1),importId:options.importId,companyId:options.companyId,period:options.period,line:i+1,raw,cfop,direction:Number(cfop[0])<4?'entrada':'saida',directionDeclared:d.v[2]==='0'?'entrada':'saida',
     amount:amount(v[reg==='C170'?7:5],true),base:amount(v[reg==='C170'?13:6]),tax:amount(v[reg==='C170'?15:7]),stBase:amount(v[reg==='C170'?16:8]),stTax:amount(v[reg==='C170'?18:9]),exempt:0,other:0,taxConfirmed:true,taxLabel:d.v[2]==='0'?'ICMS creditado na EFD':'ICMS debitado na EFD',taxMapping:'cabecalho',sourceKind:'efd-icms',granularity:reg==='C170'?'item':'c190',fiscal,
     ...(operationDate?{date:operationDate}:{}),...(d.v[9]?{key:d.v[9]}:{}),document:d.v[8],documentGroup:options.importId+':C100:'+d.line,documentAmount:amount(d.v[12],true),documentSource:{raw:d.raw,line:d.line,base:amount(d.v[21]),tax:amount(d.v[22])},...(participants.get(d.v[4])?{counterpartyCnpj:participants.get(d.v[4])}:{})};
    if(e.date&&!e.date.startsWith(options.period)){warnings.push('Há documento extemporâneo. A vigência fiscal considera sua data; confira o tratamento no período de escrituração.');}
    if(reg==='C170'){e.itemId=v[2];if(!/^\d+$/.test(v[2])||d.items.some(it=>it.itemId===e.itemId))throw new Error('NUM_ITEM ausente ou duplicado no documento.');e.itemDiscount=amount(v[8]);d.items.push(e);totalItems++;}
    else d.rows.push(e);
    if(entries.length+d.rows.length+totalItems>MAX_ROWS)throw new Error('Limite de '+MAX_ROWS+' registros analíticos e itens por arquivo.');
   }
   if(reg==='E100'){if(assessmentPeriod)throw new Error('Mais de uma apuração E100 exige segmentação adicional.');assessmentPeriod=true;if(date(v[2])!==start||date(v[3])!==end)throw new Error('Período E100 diferente do registro 0000.');}
   if(reg==='E110'){if(!assessmentPeriod||assessment)throw new Error('Apuração E110 ausente de E100 ou duplicada.');assessment={debit:amount(v[2],true),credit:amount(v[6],true),raw,line:i+1};}
   if(/^(C[3-8]\d0|D[1-7]\d0)$/.test(reg))unsupported.add(reg);
  }catch(e){throw new ImportError('Linha '+(i+1)+': '+(e as Error).message,[i+1]);}
 }
 try{finish();}catch(e){throw new ImportError((e as Error).message);}
 if(!hasClose)throw new ImportError('EFD sem fechamento 9999. Não será importado um arquivo truncado.');
 if(!entries.length)warnings.push('Nenhum C190 encontrado; confirme ausência de movimento apenas se os blocos suportados estiverem vazios.');
 const coverageWarnings=unsupported.size?['Cobertura parcial: registros '+[...unsupported].sort().join(', ')+' não compõem os totais desta versão. A comparação com E110 permanece em Revisar.']:[];
 if(!entries.length&&unsupported.size)throw new ImportError('A EFD contém apenas operações fora de C100/C190. Não será tratada como arquivo sem movimento.');
 if(!assessment)coverageWarnings.push('E110 não disponível: apuração não reconciliada.');
 warnings.push(...coverageWarnings,'C190 compõe os totais. C100 e C170 são evidências de conferência, sem soma duplicada. Valores de C170 podem diferir de C190 por descontos, despesas e tributos; as diferenças ficam explícitas.');
 return {entries,warnings:[...new Set(warnings)],encoding,sourceKind:'efd-icms' as const,sourceCnpj,assessment,coverageWarnings};
}
