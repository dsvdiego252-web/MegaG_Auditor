import { audit } from './audit';
import { DEFAULT_COMPANIES,type AppData,type Entry,type Rule,type Snapshot } from './types';
export function demoData(period='2026-08'):AppData {
  const companies=DEFAULT_COMPANIES.map((c,i)=>({...c,name:i===0?'Matriz · Exemplo':c.name+' · Exemplo',uf:i===2?'MG':'SP'}));
  const rules:Rule[]=[
    {id:'demo-compra',cfop:'1102',companyId:'',uf:'',start:'2026-01',end:'',category:'tributada',operation:'compra',credit:'permitir',expectCredit:true,reason:'Cenário fictício de compra com crédito esperado para demonstrar o motor. Não representa orientação tributária.',reference:'Regra de demonstração — sem valor fiscal',active:true},
    {id:'demo-venda',cfop:'5102',companyId:'',uf:'',start:'2026-01',end:'',category:'tributada',operation:'venda',credit:'revisar',expectCredit:false,reason:'Cenário de venda fictícia, sujeito a revisão.',reference:'Regra de demonstração — sem valor fiscal',active:true},
    {id:'demo-st',cfop:'5405',companyId:'',uf:'',start:'2026-01',end:'',category:'st',operation:'venda',credit:'vedar',expectCredit:false,reason:'Cenário fictício de classificação ST para demonstrar a interface.',reference:'Regra de demonstração — sem valor fiscal',active:true},
    {id:'demo-consumo',cfop:'1556',companyId:'',uf:'',start:'2026-01',end:'',category:'outras',operation:'outra',credit:'vedar',expectCredit:false,reason:'Neste exemplo fictício, a política cadastrada veda crédito para a operação.',reference:'Regra de demonstração — sem valor fiscal',active:true},
    ...['1152','5152'].map((cfop,i)=>({id:'demo-trans-'+i,cfop,pairedCfops:[i===0?'5152':'1152'],companyId:'',uf:'',start:'2026-01',end:'',category:'outras' as const,operation:'transferencia' as const,credit:'vedar' as const,expectCredit:false,reason:'Cenário fictício de transferência entre empresas do grupo.',reference:'Regra de demonstração — sem valor fiscal',active:true}))
  ];
  const entries:Entry[]=[];
  const cfops=['1102','5102','5405','1556','1949','1152','5152'];
  for(let c=0;c<6;c++) for(let n=0;n<7;n++) {
    const amount=(c===0?184350000:(c+2)*19456000)+(n*1743000);
    const cfop=cfops[n],direction=Number(cfop[0])<4?'entrada':'saida';
    const tax=n===0?(c===1?0:Math.round(amount*.12)):n===1?Math.round(amount*.15):n===3&&c===0?342180:0;
    entries.push({id:'demo-'+c+'-'+n,importId:'demo-import-'+c,companyId:companies[c].id,period,line:n+2,raw:cfop+';'+(amount/100).toFixed(2).replace('.',',')+';… (linha fictícia)',cfop,direction,amount,base:n<2?amount:0,tax,exempt:0,other:n>=2?amount:0,taxConfirmed:true});
  }
  // Documentos sintéticos: nenhuma chave ou empresa corresponde a operação real.
  const makeKey=(n:number)=>{const first='35'+'2608'+'00000000000000'+'55'+'001'+String(n).padStart(9,'0')+'1'+'00000001';let sum=0;for(let i=42,w=2;i>=0;i--,w=w===9?2:w+1)sum+=Number(first[i])*w;const digit=11-sum%11;return first+(digit>=10?0:digit);};
  const pair=[entries.find(e=>e.id==='demo-0-6')!,entries.find(e=>e.id==='demo-1-5')!];
  pair.forEach((e,i)=>Object.assign(e,{amount:7500000,other:7500000,key:makeKey(1),document:'DEMO-001',counterpart:i===0?'02':'01',raw:e.cfop+';75000,00;0,00;0,00;0,00;75000,00;'+makeKey(1)+';DEMO-001;'+(i===0?'02':'01')+';'+period+'-01'}));
  const unmatched=entries.find(e=>e.id==='demo-2-6')!;
  Object.assign(unmatched,{key:makeKey(2),document:'DEMO-002',counterpart:'04'});
  const imports=companies.map((c,i)=>({id:'demo-import-'+i,companyId:c.id,period,filename:'DEMONSTRACAO_'+c.id+'_ApuIcms.txt',hash:'exemplo-ficticio',rowCount:7,uploadedAt:period+'-28T12:00:00Z',warnings:[],taxMode:'por-direcao' as const,emptyConfirmed:false}));
  const result=audit(entries,rules,companies);
  const snapshot:Snapshot={id:'demo-snapshot',period,processedAt:period+'-28T12:00:00Z',...result,rules,imports,companies,inputFingerprint:'demo',ruleFingerprint:'demo'};
  return {demo:true,companies,rules,imports,snapshot,stale:false,periods:[period]};
}
