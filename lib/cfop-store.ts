import {database,lock} from './db';
import {recordEvent} from './store';
import {buildCfopSeed,catalogStats,type CfopMasterRule,CFOP_SOURCE} from './cfop-master';
import {auditSettingsSchema,DEFAULT_AUDIT_SETTINGS} from './movement-audit';
import {HttpError} from './security';
import {z} from 'zod';
export async function installCfopCatalog(actor:string){
 const seeds=buildCfopSeed(),columns=Object.keys(seeds[0]);
 const db=await database();return db.transaction(async tx=>{
  await lock(tx);
  const updates=columns.filter(c=>c!=='id'&&c!=='versao').map(c=>c+'=excluded.'+c).join(',');
  const changed=await tx.query<CfopMasterRule>(`INSERT INTO cfop_master_rules SELECT * FROM jsonb_populate_recordset(NULL::cfop_master_rules,$1::jsonb) ON CONFLICT(id) DO UPDATE SET ${updates},versao=cfop_master_rules.versao+1 WHERE cfop_master_rules.source_hash IS DISTINCT FROM excluded.source_hash OR cfop_master_rules.seed_version IS DISTINCT FROM excluded.seed_version RETURNING *`,[JSON.stringify(seeds)]);
  if(changed.length)await tx.query('INSERT INTO cfop_master_history(rule_id,version,payload) SELECT x.id,x.versao,to_jsonb(x) FROM jsonb_populate_recordset(NULL::cfop_master_rules,$1::jsonb) x',[JSON.stringify(changed)]);
  await tx.query("INSERT INTO mega_audit_settings(id,version,payload) VALUES('icms',1,$1::jsonb) ON CONFLICT DO NOTHING",[JSON.stringify(DEFAULT_AUDIT_SETTINGS)]);
  await recordEvent(tx,actor,'instalar-catalogo-cfop',{version:CFOP_SOURCE.version,hash:CFOP_SOURCE.sourceHash,changed:changed.length,total:seeds.length});
  return {...catalogStats(seeds),changed:changed.length};
 });
}
export async function cfopCatalog(page=0,query='',group='all'){
 const rows=await (await database()).query<CfopMasterRule>('SELECT * FROM cfop_master_rules ORDER BY cfop,vigencia_inicial DESC');
 const filtered=rows.filter(r=>(group==='all'||r.grupo_cfop===group)&&(r.cfop+' '+r.descricao_oficial).toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
 return {...catalogStats(rows),rows:filtered.slice(page*40,page*40+40),filtered:filtered.length,page};
}
export async function saveAuditSettings(input:unknown,actor:string){
 const {version,...value}=auditSettingsSchema.extend({version:z.number().int().positive()}).parse(input),db=await database();
 return db.transaction(async tx=>{
  await lock(tx);const [before]=await tx.query<{version:number;payload:unknown}>("SELECT version,payload FROM mega_audit_settings WHERE id='icms'");
  if(!before||before.version!==version)throw new HttpError('A configuração mudou. Atualize a tela antes de salvar.',409);
  await tx.query("UPDATE mega_audit_settings SET version=version+1,payload=$1::jsonb WHERE id='icms'",[JSON.stringify(value)]);
  await recordEvent(tx,actor,'configurar-reconciliacao',{before,after:value,version:version+1});return {version:version+1,...value};
 });
}
