import test from 'node:test';
import assert from 'node:assert/strict';
import {databaseDiagnostic} from '../lib/db-diagnostics';

test('falhas conhecidas de banco explicam a causa sem expor credenciais, SQL ou detalhes do driver',()=>{
  const sensitive='postgresql://usuario:senha-privada@host-privado/banco-privado';
  for(const code of ['28P01','ENOTFOUND','SELF_SIGNED_CERT_IN_CHAIN','42501','ERR_INVALID_URL']) {
    const diagnostic=databaseDiagnostic({code,message:sensitive,detail:'SELECT dados_privados FROM lancamentos',stack:sensitive});
    assert.equal(diagnostic?.code,code);
    assert.ok(diagnostic?.message);
    assert.ok(!JSON.stringify(diagnostic).includes(sensitive));
    assert.ok(!JSON.stringify(diagnostic).includes('dados_privados'));
  }
  assert.match(databaseDiagnostic({code:'28P01'})!.message,/autenticação/);
  assert.match(databaseDiagnostic({code:'SELF_SIGNED_CERT_IN_CHAIN'})!.message,/certificado CA/);
});

test('diagnóstico alcança causas encapsuladas sem loop ou divulgação de mensagens desconhecidas',()=>{
  assert.equal(databaseDiagnostic({cause:{errors:[{code:'ENETUNREACH'}]}})?.code,'ENETUNREACH');
  const cyclic:{cause?:unknown}={};cyclic.cause=cyclic;
  assert.equal(databaseDiagnostic(cyclic),null);
  assert.equal(databaseDiagnostic({code:'SEGREDO',message:'senha-privada'}),null);
  assert.equal(databaseDiagnostic({code:'toString'}),null);
  assert.equal(databaseDiagnostic(null),null);
});

test('erros sem código do pooler e da configuração recebem identificação segura',()=>{
  assert.equal(databaseDiagnostic(new Error('Configure DATABASE_URL para usar dados reais em produção.'))?.code,'DATABASE_URL_MISSING');
  assert.equal(databaseDiagnostic(new Error('Tenant or user not found: projeto-privado'))?.code,'DATABASE_POOLER_USER');
  assert.equal(databaseDiagnostic(new Error('SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string'))?.code,'DATABASE_PASSWORD_MISSING');
  assert.equal(databaseDiagnostic(new Error('Connection terminated due to connection timeout'))?.code,'DATABASE_TIMEOUT');
});
