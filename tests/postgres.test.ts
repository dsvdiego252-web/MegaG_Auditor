import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from '../lib/db';
import {importFiles,loadData,processPeriod,saveRule} from '../lib/store';
test('adaptador PostgreSQL externo: importação, processamento e obsolescência',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
 process.env.DATA_ENCRYPTION_KEY='c'.repeat(64);
 const period='2099-12';
 const text='CFOP;Valor Contábil;Base de Cálculo;Imposto Creditado;Isentas ou Não tributadas;Outras\n1102;100,00;100,00;12,00;0,00;0,00';
 const [record]=await importFiles([{file:new File([text],'teste_ApuIcms.txt'),companyId:'01',period,taxMode:'confirmar',emptyConfirmed:false,replace:true}],'CI');
 assert.equal(record.rowCount,1);
 const result=await processPeriod(period,'CI');
 assert.equal(result.entries[0].amount,10000);
 await saveRule({id:randomUUID(),cfop:'1102',companyId:'01',uf:'',start:period,end:period,category:'tributada',operation:'compra',credit:'permitir',expectCredit:false,reason:'Regra fictícia do banco descartável do CI.',reference:'Teste de integração PostgreSQL',active:true},'CI');
 assert.equal((await loadData(period)).stale,true);
 await (await database()).close();
});
