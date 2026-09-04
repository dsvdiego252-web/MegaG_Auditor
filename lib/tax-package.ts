import {z} from 'zod';
import type {TaxRuleInput} from './tax-motor';
const record=z.record(z.string(),z.unknown());
const packageSchema=z.object({meta:z.object({nome:z.string().min(1).max(200),versao:z.string().min(1).max(50)}).passthrough(),icms_sp:record,casos_validados_historicos:z.array(record).max(200)}).passthrough();
export type TaxSeed={title:string;domain:TaxRuleInput['domain'];reference:string;sourcePath:string;source:unknown};
export function parseTaxPackage(bytes:Uint8Array){
  if(bytes.length>256_000)throw new Error('O pacote JSON excede 256 KB.');
  const content=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''));
  const parsed=packageSchema.parse(content),seeds:TaxSeed[]=[];
  function add(source:unknown,path:string,title:string,domain:TaxSeed['domain']='ICMS'){
    if(source===undefined||source===null)return;
    const object=typeof source==='object'&&!Array.isArray(source)?source as Record<string,unknown>:{};
    const reference=[object.referencia,object.fonte,object.base_principal].filter(v=>typeof v==='string').join(' · ');
    seeds.push({title:title.slice(0,250),domain,reference:reference.slice(0,2000),sourcePath:path,source});
  }
  function items(value:unknown,path:string,label:string,domain:TaxSeed['domain']='ICMS'){
    if(value===undefined)return;
    for(const [i,item] of z.array(record).max(200).parse(value).entries())add(item,path+'.'+i,String(item.produto||item.id||item.segmento||label+' '+(i+1)),domain);
  }
  items(parsed.icms_sp.regras_gerais,'icms_sp.regras_gerais','Referência ICMS');
  const st=record.parse(parsed.icms_sp.st||{}),benefit=record.parse(parsed.icms_sp.cbenef||{});
  add(st.regra_mestra,'icms_sp.st.regra_mestra','Enquadramento de ICMS-ST');
  items(st.portarias_sre_referencia,'icms_sp.st.portarias_sre_referencia','Referência de MVA');
  add(benefit.carne_supermercado,'icms_sp.cbenef.carne_supermercado','cBenef — carne em supermercado');
  add(benefit.acougue,'icms_sp.cbenef.acougue','cBenef — açougue');
  items(parsed.casos_validados_historicos,'casos_validados_historicos','Caso histórico');
  const pis=record.parse(parsed.pis_cofins||{}),sped=record.parse(parsed.sped||{});
  items(pis.casos_conhecidos,'pis_cofins.casos_conhecidos','Referência PIS/COFINS','PIS/COFINS');
  add(pis.regra_mestra,'pis_cofins.regra_mestra','Roteiro PIS/COFINS','PIS/COFINS');
  add(parsed.reforma_tributaria,'reforma_tributaria','Referências IBS/CBS','IBS/CBS');
  for(const [path,title] of [['auditoria_cfop','Auditoria por CFOP'],['transferencias_grupo','Transferências entre empresas'],['auditoria_xml_nfe','Auditoria de XML/NF-e']] as const)add(parsed[path],path,title,'Procedimento');
  add(sped.efd_icms_ipi,'sped.efd_icms_ipi','Roteiro EFD ICMS/IPI','Procedimento');
  add(sped.efd_contribuicoes,'sped.efd_contribuicoes','Roteiro EFD-Contribuições','Procedimento');
  if(!seeds.length||seeds.length>250)throw new Error('Pacote sem referências reconhecidas ou acima de 250 registros.');
  // Natural-language instructions and historical percentages are preserved as
  // source material. They NEVER become executable fiscal assertions on import.
  return {name:parsed.meta.nome,version:parsed.meta.versao,seeds};
}
