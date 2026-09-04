import {rootCertificates} from 'node:tls';
import type {PoolConfig} from 'pg';
import supabaseCa from './certificates/supabase-root-2021.json';

export function postgresPoolConfig(connectionString:string):PoolConfig {
  const config:PoolConfig={connectionString,max:3,idleTimeoutMillis:20000,connectionTimeoutMillis:10000};
  let url:URL;
  try {url=new URL(connectionString);} catch {return config;}
  if(!['postgres:','postgresql:'].includes(url.protocol)) return config;
  // O driver permite sobrescrever o host pela query string; use o host efetivo.
  const host=(url.searchParams.getAll('host').at(-1)||url.hostname).toLowerCase();
  const supabase=/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)||/^db\.[a-z0-9]+\.supabase\.co$/.test(host);
  if(!supabase) return config;
  // Uma configuração explícita de certificados continua sob controle do operador.
  if(['sslrootcert','sslcert','sslkey'].some(name=>url.searchParams.has(name))) return config;
  // pg dá precedência aos parâmetros da URL e apagaria a CA fornecida em ssl.
  for(const name of ['sslmode','ssl','uselibpqcompat']) url.searchParams.delete(name);
  return {...config,connectionString:url.toString(),ssl:{
    ca:[...rootCertificates,supabaseCa.certificate],
    rejectUnauthorized:true,
    minVersion:'TLSv1.2',
  }};
}
