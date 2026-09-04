import test from 'node:test';
import assert from 'node:assert/strict';
import {HttpError,login} from '../lib/security';

test('login identifica configuração ausente antes de acessar o banco, sem revelar valores',async()=>{
  const names=['ADMIN_PASSWORD_HASH','DATA_ENCRYPTION_KEY','VERCEL','DATABASE_URL'];
  const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  const secret='valor-confidencial-que-nao-pode-aparecer';
  try {
    process.env.DATABASE_URL='postgresql://invalid:invalid@127.0.0.1:1/invalid';
    process.env.VERCEL='1';
    for(const missing of [['ADMIN_PASSWORD_HASH'],['DATA_ENCRYPTION_KEY'],['ADMIN_PASSWORD_HASH','DATA_ENCRYPTION_KEY']]) {
      process.env.ADMIN_PASSWORD_HASH=secret;
      process.env.DATA_ENCRYPTION_KEY=secret;
      for(const name of missing) delete process.env[name];
      await assert.rejects(login('teste@example.com','senha-de-teste'),error=>{
        assert.ok(error instanceof HttpError);
        assert.equal(error.status,503);
        const message=error.message;
        for(const name of ['ADMIN_PASSWORD_HASH','DATA_ENCRYPTION_KEY']) assert.equal(message.includes(name),missing.includes(name));
        assert.match(message,/Production da Vercel/);
        assert.ok(!message.includes(secret));
        return true;
      });
    }
    process.env.ADMIN_PASSWORD_HASH=' \n ';
    process.env.DATA_ENCRYPTION_KEY=secret;
    delete process.env.VERCEL;
    await assert.rejects(login('teste@example.com','senha-de-teste'),error=>{
      assert.ok(error instanceof HttpError);
      assert.equal(error.status,503);
      assert.match(error.message,/ADMIN_PASSWORD_HASH/);
      assert.match(error.message,/\.env\.local/);
      assert.ok(!error.message.includes(secret));
      return true;
    });
  } finally {
    for(const name of names) {
      if(previous[name]===undefined) delete process.env[name];
      else process.env[name]=previous[name];
    }
  }
});
