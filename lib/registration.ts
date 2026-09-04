export function validCnpj(cnpj:string) {
  if(!/^\d{14}$/.test(cnpj)||/^(\d)\1+$/.test(cnpj))return false;
  const digit=(size:number)=>{let sum=0;for(let i=0,w=size-7;i<size;i++,w=w===2?9:w-1)sum+=Number(cnpj[i])*w;return sum%11<2?0:11-sum%11;};
  return digit(12)===Number(cnpj[12])&&digit(13)===Number(cnpj[13]);
}
export type Registration = {id:string;legalName:string;cnpj:string;uf:string;stateRegistration:string;municipalityCode:string;line:number};
export function parseEstablishments(buffer:Uint8Array):Registration[] {
  let text:string;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{text=new TextDecoder('windows-1252').decode(buffer);}
  const records:Registration[]=[];
  text.replace(/^\uFEFF/,'').split(/\r\n|\n|\r/).forEach((line,index)=>{
    if(!line.startsWith('|0140|'))return;
    const [, ,code,legalName,cnpj,uf,stateRegistration,municipalityCode]=line.split('|');
    const id=code?.padStart(2,'0');
    if(!/^0[1-6]$/.test(id))throw new Error('Código de estabelecimento fora do grupo na linha '+(index+1));
    if(!validCnpj(cnpj)||!legalName?.trim()||!/^([A-Z]{2})$/.test(uf))throw new Error('Cadastro 0140 inválido na linha '+(index+1));
    const r={id,legalName:legalName.trim(),cnpj,uf,stateRegistration,municipalityCode,line:index+1};
    const previous=records.find(x=>x.id===id);
    if(previous&&JSON.stringify({...previous,line:0})!==JSON.stringify({...r,line:0}))throw new Error('Cadastros conflitantes para a empresa '+id);
    if(!previous)records.push(r);
  });
  if(!records.length)throw new Error('Nenhum registro 0140 encontrado.');
  return records;
}
