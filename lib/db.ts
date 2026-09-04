import { mkdir } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { homedir } from 'node:os';
import { DEFAULT_COMPANIES } from './types';
import {postgresPoolConfig} from './postgres-config';
type Row = Record<string, unknown>;
export type Connection = { query<T = Row>(sql: string, params?: unknown[]): Promise<T[]> };
export type Database = Connection & { close():Promise<void>; transaction<T>(fn:(db:Connection)=>Promise<T>):Promise<T> };
const globalDb = globalThis as unknown as { megaDatabase?: Promise<Database> };
async function initialize():Promise<Database> {
  let db:Database;
  if (process.env.DATABASE_URL) {
    const { Pool } = await import('pg');
    const pool = new Pool(postgresPoolConfig(process.env.DATABASE_URL));
    db = { close: async () => pool.end(),
      query: async <T>(sql:string, params:unknown[]=[]) => (await pool.query(sql,params)).rows as T[],
      transaction: async fn => {
        const client=await pool.connect();
        try { await client.query('BEGIN'); const result=await fn({query:async <T>(s:string,p:unknown[]=[]) => (await client.query(s,p)).rows as T[]}); await client.query('COMMIT'); return result; }
        catch(e) {await client.query('ROLLBACK');throw e;} finally{client.release();}
      }
    };
  } else {
    if(process.env.VERCEL || process.env.NODE_ENV==='production' && process.env.ALLOW_LOCAL_DATABASE!=='true') throw new Error('Configure DATABASE_URL para usar dados reais em produção.');
    const {PGlite}=await import('@electric-sql/pglite');
    const defaultDirectory=process.platform==='win32'?join(process.env.LOCALAPPDATA||join(homedir(),'AppData','Local'),'MegaG-Auditor','postgres'):'.data/postgres-local';
    const directory=resolve(process.env.LOCAL_DATABASE_PATH||defaultDirectory);
    await mkdir(directory,{recursive:true});
    const pg=new PGlite(directory);
    await pg.waitReady;
    db={close: async () => pg.close(),
      query: async <T>(s:string,p:unknown[]=[]) => (await pg.query(s,p)).rows as T[],
      transaction: async fn => pg.transaction(async tx=>fn({query:async <T>(s:string,p:unknown[]=[]) => (await tx.query(s,p)).rows as T[]}))
    };
  }
  await db.query('CREATE TABLE IF NOT EXISTS mega_lock (id integer PRIMARY KEY)');
  await db.query('INSERT INTO mega_lock(id) VALUES (1) ON CONFLICT DO NOTHING');
  const ddl = [
    'CREATE TABLE IF NOT EXISTS mega_companies (id text PRIMARY KEY, payload jsonb NOT NULL)',
    'CREATE TABLE IF NOT EXISTS mega_imports (id text PRIMARY KEY, company_id text NOT NULL REFERENCES mega_companies(id), period text NOT NULL, active boolean NOT NULL DEFAULT true, payload jsonb NOT NULL, entries jsonb NOT NULL, source text NOT NULL)',
    'CREATE UNIQUE INDEX IF NOT EXISTS mega_active_import ON mega_imports(company_id,period) WHERE active',
    'CREATE INDEX IF NOT EXISTS mega_import_period ON mega_imports(period)',
    'CREATE TABLE IF NOT EXISTS mega_period_declarations (company_id text NOT NULL REFERENCES mega_companies(id), period text NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(company_id,period))',
    'CREATE TABLE IF NOT EXISTS mega_rules (id text PRIMARY KEY, payload jsonb NOT NULL)',
    'CREATE TABLE IF NOT EXISTS mega_tax_packages (id text PRIMARY KEY, hash text NOT NULL UNIQUE, payload jsonb NOT NULL, source text NOT NULL)',
    'CREATE TABLE IF NOT EXISTS mega_tax_rules (id text PRIMARY KEY, payload jsonb NOT NULL)',
    'CREATE TABLE IF NOT EXISTS mega_tax_revisions (rule_id text NOT NULL REFERENCES mega_tax_rules(id), version integer NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(rule_id,version))',
    'CREATE TABLE IF NOT EXISTS mega_snapshots (id text PRIMARY KEY, period text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL)',
    'CREATE INDEX IF NOT EXISTS mega_snapshot_period ON mega_snapshots(period,created_at DESC)',
    'CREATE TABLE IF NOT EXISTS mega_events (id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), actor text NOT NULL, action text NOT NULL, payload jsonb NOT NULL)',
    'CREATE TABLE IF NOT EXISTS mega_sessions (id text PRIMARY KEY, expires_at timestamptz NOT NULL)',
    'CREATE TABLE IF NOT EXISTS mega_login_limit (id text PRIMARY KEY, failures integer NOT NULL DEFAULT 0, reset_at timestamptz NOT NULL)'
  ];
  for(const sql of ddl) await db.query(sql);
  for(const c of DEFAULT_COMPANIES) await db.query('INSERT INTO mega_companies(id,payload) VALUES ($1,$2::jsonb) ON CONFLICT DO NOTHING',[c.id,JSON.stringify(c)]);
  return db;
}
export function database() { return globalDb.megaDatabase ??= initialize().catch(e=>{delete globalDb.megaDatabase;throw e;}); }
export async function lock(db:Connection) {await db.query('SELECT id FROM mega_lock WHERE id=1 FOR UPDATE');}
