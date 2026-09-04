export type CfopScope = 'interna'|'interestadual'|'exterior';
// O primeiro dígito identifica a abrangência declarada, sem validar a operação real.
const PREFIXES:Record<string,{scope:CfopScope;label:string}>={
  '1':{scope:'interna',label:'Entrada interna — CFOP 1.xxx'},
  '2':{scope:'interestadual',label:'Entrada interestadual — CFOP 2.xxx'},
  '3':{scope:'exterior',label:'Entrada do exterior — CFOP 3.xxx'},
  '5':{scope:'interna',label:'Saída interna — CFOP 5.xxx'},
  '6':{scope:'interestadual',label:'Saída interestadual — CFOP 6.xxx'},
  '7':{scope:'exterior',label:'Saída para o exterior — CFOP 7.xxx'}
};
export function cfopScope(cfop:string){return /^[123567]\d{3}$/.test(cfop)?PREFIXES[cfop[0]]:undefined;}
