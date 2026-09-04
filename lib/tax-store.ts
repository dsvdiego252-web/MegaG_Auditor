import {randomUUID} from 'node:crypto';
import {database,lock} from './db';
import {encrypt,hash,HttpError} from './security';
import {recordEvent} from './store';
import {taxRuleInput,type TaxPackage,type TaxRule} from './tax-motor';
import {parseTaxPackage} from './tax-package';

export async function importTaxPackage(bytes:Uint8Array,filename:string,actor:string){
  let parsed:ReturnType<typeof parseTaxPackage>;
  try{parsed=parseTaxPackage(bytes);}catch{throw new HttpError('Pacote inválido. Envie o motor-tributario.json com meta, icms_sp e casos_validados_historicos (até 256 KB).',422);}
  const digest=hash(bytes),db=await database();
  return db.transaction(async tx=>{
    await lock(tx);
    const [existing]=await tx.query<{payload:TaxPackage}>('SELECT payload FROM mega_tax_packages WHERE hash=$1',[digest]);
    if(existing)return {package:existing.payload,duplicate:true};
    const [{count}]=await tx.query<{count:string}>('SELECT count(*)::text AS count FROM mega_tax_rules');
    if(Number(count)+parsed.seeds.length>500)throw new HttpError('Limite de 500 referências nesta versão.',413);
    const pkg:TaxPackage={id:randomUUID(),name:parsed.name,version:parsed.version,filename:filename.replace(/[\\/\r\n]/g,'_').slice(0,180)||'motor-tributario.json',hash:digest,importedAt:new Date().toISOString(),importedBy:actor,ruleCount:parsed.seeds.length};
    await tx.query('INSERT INTO mega_tax_packages(id,hash,payload,source) VALUES($1,$2,$3::jsonb,$4)',[pkg.id,digest,JSON.stringify(pkg),encrypt(bytes)]);
    for(const seed of parsed.seeds){
      const rule:TaxRule={...seed,id:randomUUID(),packageId:pkg.id,version:1,status:'pendente',start:'',end:'',reason:'',conditions:[],requiredFields:[],checks:[],updatedAt:pkg.importedAt,updatedBy:actor};
      await tx.query('INSERT INTO mega_tax_rules(id,payload) VALUES($1,$2::jsonb)',[rule.id,JSON.stringify(rule)]);
      await tx.query('INSERT INTO mega_tax_revisions(rule_id,version,payload) VALUES($1,1,$2::jsonb)',[rule.id,JSON.stringify(rule)]);
    }
    await recordEvent(tx,actor,'importar-motor',{packageId:pkg.id,hash:digest,ruleCount:pkg.ruleCount,status:'pendente'});
    return {package:pkg,duplicate:false};
  });
}
export async function saveTaxRule(input:unknown,actor:string){
  const parsed=taxRuleInput.parse(input),db=await database();
  return db.transaction(async tx=>{
    await lock(tx);
    const [row]=await tx.query<{payload:TaxRule}>('SELECT payload FROM mega_tax_rules WHERE id=$1',[parsed.id]);
    if(!row)throw new HttpError('Referência não encontrada.',404);
    if(row.payload.version!==parsed.version)throw new HttpError('Esta regra foi alterada em outra sessão. Atualize a tela antes de salvar.',409);
    const updatedAt=new Date().toISOString();
    const rule:TaxRule={...row.payload,...parsed,version:parsed.version+1,updatedAt,updatedBy:actor,validatedBy:parsed.status==='validada'?actor:undefined,validatedAt:parsed.status==='validada'?updatedAt:undefined};
    await tx.query('UPDATE mega_tax_rules SET payload=$2::jsonb WHERE id=$1',[rule.id,JSON.stringify(rule)]);
    await tx.query('INSERT INTO mega_tax_revisions(rule_id,version,payload) VALUES($1,$2,$3::jsonb)',[rule.id,rule.version,JSON.stringify(rule)]);
    await recordEvent(tx,actor,'versionar-motor',{ruleId:rule.id,before:parsed.version,after:rule.version,status:rule.status});
    return rule;
  });
}
