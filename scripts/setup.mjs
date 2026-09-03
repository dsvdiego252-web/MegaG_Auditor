import { randomBytes,scryptSync } from 'node:crypto';
import { existsSync,writeFileSync } from 'node:fs';
if(existsSync('.env.local')) {console.log('Configuração existente preservada. Consulte .env.local e ACESSO-LOCAL.txt.');process.exit(0);}
const password=randomBytes(18).toString('base64url');
const salt=randomBytes(16).toString('hex');
const hash=scryptSync(password,salt,64).toString('hex');
writeFileSync('.env.local',[
  'LOCAL_DATABASE_PATH=.data/postgres-local',
  'ADMIN_EMAIL=admin@megag.local',
  'ADMIN_PASSWORD_HASH='+salt+':'+hash,
  'DATA_ENCRYPTION_KEY='+randomBytes(32).toString('hex'),
  'APP_ORIGIN=http://127.0.0.1:3000',
  'ALLOW_LOCAL_DATABASE=true',''
].join('\n'),{flag:'wx'});
writeFileSync('ACESSO-LOCAL.txt','Mega G — acesso local (não compartilhar ou versionar)\n\nURL: http://127.0.0.1:3000\nE-mail: admin@megag.local\nSenha: '+password+'\n\nAs credenciais de produção devem ser configuradas separadamente.\n',{flag:'wx'});
console.log('Configuração local criada. Credenciais em ACESSO-LOCAL.txt (ignorado pelo Git).');
