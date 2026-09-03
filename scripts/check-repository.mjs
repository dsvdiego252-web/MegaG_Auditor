import {execFileSync} from 'node:child_process';
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const forbidden=files.filter(f=>/^(ICMS\/|EFD-Contribuições\/|\.data\/|uploads\/|exports\/|ACESSO-LOCAL\.txt|\.env(?!\.example$))/.test(f));
if(forbidden.length){console.error('Arquivos privados rastreados:',forbidden);process.exit(1);}
console.log('Nenhum relatório fiscal, banco ou arquivo de credenciais rastreado.');
