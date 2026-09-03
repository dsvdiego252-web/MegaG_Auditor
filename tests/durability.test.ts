import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
test('banco local preserva registros após saída abrupta e reabertura em outro processo',()=>{
 const dir='.data/durability-'+randomUUID();
 const init="import {PGlite} from '@electric-sql/pglite'; const db=new PGlite("+JSON.stringify(dir)+"); await db.query('CREATE TABLE durability (amount integer)'); await db.query('INSERT INTO durability VALUES (123456)'); process.exit(0);";
 execFileSync(process.execPath,['--input-type=module','-e',init],{stdio:'pipe'});
 const read="import {PGlite} from '@electric-sql/pglite'; const db=new PGlite("+JSON.stringify(dir)+"); const r=await db.query('SELECT amount FROM durability'); console.log(r.rows[0].amount); await db.close();";
 assert.equal(execFileSync(process.execPath,['--input-type=module','-e',read],{encoding:'utf8'}).trim(),'123456');
});
