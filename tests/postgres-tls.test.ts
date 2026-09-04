import test from 'node:test';
import assert from 'node:assert/strict';
import {X509Certificate} from 'node:crypto';
import type {ConnectionOptions} from 'node:tls';
import {Client} from 'pg';
import {postgresPoolConfig} from '../lib/postgres-config';
import supabaseCa from '../lib/certificates/supabase-root-2021.json';

test('o driver mantém a CA do Supabase e a verificação TLS mesmo com sslmode na URL',()=>{
  for(const mode of ['require','verify-full','no-verify','disable']) {
    const client=new Client(postgresPoolConfig('postgresql://postgres.exemplo:senha%40teste@aws-0-us-east-2.pooler.supabase.com:6543/postgres?sslmode='+mode+'&application_name=megag'));
    const parameters=(client as unknown as {connectionParameters:{ssl:ConnectionOptions;password:string;host:string;application_name:string}}).connectionParameters;
    assert.equal(parameters.ssl.rejectUnauthorized,true);
    assert.equal(parameters.ssl.checkServerIdentity,undefined);
    assert.equal(parameters.ssl.minVersion,'TLSv1.2');
    assert.ok(Array.isArray(parameters.ssl.ca)&&parameters.ssl.ca.includes(supabaseCa.certificate));
    assert.equal(parameters.password,'senha@teste');
    assert.equal(parameters.host,'aws-0-us-east-2.pooler.supabase.com');
    assert.equal(parameters.application_name,'megag');
  }
  assert.ok(postgresPoolConfig('postgresql://postgres:teste@db.exemplo.supabase.co:5432/postgres').ssl);
});

test('a confiança adicional fica restrita ao host efetivo do Supabase',()=>{
  for(const url of [
    'postgresql://test:test@localhost:5432/test',
    'postgresql://test:test@aws-0-us-east-2.pooler.supabase.com.outro.test:6543/postgres',
    'postgresql://test:test@db.exemplo.supabase.co:5432/postgres?host=outro.test',
    'postgresql://test:test@outro.test:5432/postgres?host=db.exemplo.supabase.co&host=outro.test',
    'postgresql://test:test@db.exemplo.supabase.co:5432/postgres?sslrootcert=/certificado-do-operador.crt',
  ]) {
    const config=postgresPoolConfig(url);
    assert.equal(config.connectionString,url);
    assert.equal(config.ssl,undefined);
  }
});

test('o certificado público fixado é uma CA autêntica em formato válido e dentro da vigência',()=>{
  const ca=new X509Certificate(supabaseCa.certificate);
  assert.equal(ca.ca,true);
  assert.ok(ca.verify(ca.publicKey));
  assert.match(ca.subject,/CN=Supabase Root 2021 CA/);
  assert.equal(ca.fingerprint256,'80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
  assert.ok(Date.now()>Date.parse(ca.validFrom)&&Date.now()<Date.parse(ca.validTo));
});
