# Mega G — Auditor Fiscal

Primeira versão funcional para auditoria mensal de ICMS de uma matriz e cinco filiais. Next.js + React + TypeScript; PostgreSQL externo em produção e PostgreSQL incorporado (PGlite) persistido em disco no desenvolvimento. Não usa LocalStorage.

## Executar localmente

Requisitos: Node.js 22 ou superior e pnpm 11.19.

```sh
pnpm install
pnpm run setup
pnpm dev
```

Abra http://127.0.0.1:3000. O sistema começa na demonstração, que é somente leitura e contém exclusivamente dados fictícios. Para acessar o ambiente real, consulte o arquivo local **ACESSO-LOCAL.txt**. O comando de setup nunca sobrescreve credenciais existentes.

Os dados reais começam vazios. Nenhuma regra de demonstração é copiada para o banco real. Os testes verificam o funcionamento técnico do motor; não validam juridicamente os critérios fiscais. No Windows, o banco local fica em `%LOCALAPPDATA%/MegaG-Auditor/postgres`, fora de pastas sincronizadas; em outros sistemas, em `.data/postgres-local`. O caminho pode ser definido em `LOCAL_DATABASE_PATH`; não o abra simultaneamente em vários processos. Pare a aplicação antes de executar `pnpm db:migrate` localmente. Em produção, as conexões concorrentes usam PostgreSQL externo.

## Fluxo mensal

1. Acesse o ambiente real e confirme os nomes, UFs e CNPJs das seis empresas.
2. Selecione a competência. Envie os seis arquivos **ApuIcms.txt** de uma vez, ou em lotes menores. Confira o mapeamento da empresa.
3. O importador reconhece “Imposto Creditado” nas entradas e “Imposto Debitado” nas saídas, incluindo cabeçalhos separados ou as duas colunas. Confirme manualmente apenas quando o cabeçalho divergir do sentido da operação. Valores sem mapeamento confirmado não entram no crédito/débito e deixam o saldo pendente.
4. Para empresa sem movimento, registre a declaração na cobertura da competência, com motivo. Ela vale somente naquele mês e impede importações com valores até a reabertura. Também é possível confirmar um arquivo contendo apenas cabeçalho.
5. Clique em **Validar arquivos**, depois **Importar no banco**. O lote é atômico: uma linha inválida bloqueia todos os arquivos daquele lote.
6. Clique em **Processar competência**. O processamento salva uma versão do resultado, incluindo fontes, cadastros e regras utilizadas.
7. Revise a Central de Auditoria e cadastre critérios fiscais validados. Reprocesse para aplicar alterações.
8. Clique em um CFOP ou em “Ver origem” para conferir a linha e baixar o original preservado.
9. Exporte Excel ou o relatório de auditoria (HTML independente, que pode ser impresso/salvo em PDF no navegador).

Importações idênticas são idempotentes. Arquivo diferente exige marcar substituição; a versão anterior continua armazenada. Regras e cadastros alterados não modificam resultados históricos. O dashboard mostra aviso quando precisa de novo processamento.

## Relatórios encontrados e compatibilidade

O importador foi validado por leitura das amostras locais de ApuIcms. Os hashes antes e depois da validação coincidiram. Os originais não foram alterados nem automaticamente importados.

- Layout: CFOP, Valor Contábil, Base de Cálculo, Imposto Creditado e/ou Imposto Debitado, Isentas ou Não tributadas e Outras. Separador: ponto e vírgula.
- Codificações UTF-8 e Windows-1252. Valores brasileiros são convertidos diretamente para centavos inteiros.
- Cada valor preserva empresa, competência, número da linha, texto original, importação e hash SHA-256.
- LivroApu e OperInterUF são complementares e bloqueados como fonte principal para evitar dupla contagem. A reconciliação desses relatórios complementares fica para a próxima etapa.
- Os arquivos atuais não contêm chave NF-e ou detalhe por documento. O drill-down vai até a linha agregada do relatório.
- O modelo detalhado opcional em `public/modelo-detalhado.csv` aceita Chave NF-e, Documento, Empresa contraparte (01–06) e Data (AAAA-MM-DD). É fictício e deve ser adaptado à amostra detalhada real do Consinco. Não é afirmado que este modelo seja um exportador nativo do Consinco.

## Critérios e limitações fiscais

**Não existem regras tributárias reais pré-cadastradas.** Ausência de regra, conflito entre regras ou critério indefinido produz “Revisar”. O motor permite configurar natureza da operação, classificação do valor contábil, permissão de crédito, crédito esperado, empresa, UF, vigência, motivo e referência.

- Entradas e saídas são movimentos brutos, incluindo transferências, devoluções e outras operações. Compras e vendas são totalizadas somente a partir da natureza cadastrada na regra.
- A classificação de tributadas/isentas/ST/outras se aplica ao valor inteiro da linha por regra. Não se presume ST pelo CFOP, nem se usa base de cálculo como valor de operação tributada. CFOP com tratamentos mistos deve permanecer em Revisar até obter detalhe.
- O saldo exibido é **débito confirmado menos crédito informado nos arquivos**; não é a apuração fiscal completa. Não inclui saldo credor anterior, ajustes, estornos ou outros créditos/débitos que não constam na fonte.
- A análise de crédito não aproveitado aponta a combinação configurada (base positiva/crédito zero); nunca calcula crédito presumido.
- Transferências são identificadas por catálogo público de natureza de CFOP ou por regra cadastrada, mesmo quando o relatório é agregado. O catálogo inicial cobre 1152/2152/5152/6152 e 1409/2409/5409/6409; outros códigos podem ser cadastrados no motor. O catálogo não atribui categoria fiscal ou permissão de crédito. O primeiro dígito identifica a abrangência declarada: entradas 1/2 e saídas 5/6 indicam interna/interestadual, respectivamente. A conferência das UFs é independente: sem contraparte, fica pendente, sem gerar divergência nem impedir a identificação pelo CFOP. Quando as UFs contradizem o prefixo, o sistema gera um alerta. A conciliação documental exige uma entrada e uma saída, mesma chave, empresas distintas e recíprocas, valores iguais e par de CFOPs permitido nas duas regras. Pendências, desdobramentos e duplicidades ficam em Revisar.
- Sem chave, não se declara “Não encontrado”; registra-se “Revisar — sem chave”. “Não encontrado” exige uma chave presente em apenas um lado.
- O consolidado é bruto, sem eliminação automática de operações entre empresas.
- UFs e CNPJs não foram inferidos a partir das siglas dos arquivos. Cadastros podem ser extraídos dos registros 0140 do EFD, com razão social, CNPJ, UF, hash da fonte e linha original. O arquivo de origem permanece privado; nenhum cadastro real é incorporado ao código.

## Segurança e persistência

- Um administrador por instalação nesta fase; autenticação por senha derivada com scrypt, sessão aleatória cujo hash fica no banco, expiração em oito horas, cookie HttpOnly/SameSite=Strict e Secure com HTTPS.
- Mutações validam Origin contra APP_ORIGIN. Login tem limite persistente de tentativas.
- APIs de dados reais, originais e exportações exigem autenticação; respostas sensíveis usam no-store.
- Fontes originais são criptografadas no banco com AES-256-GCM. Registros normalizados ficam no PostgreSQL, protegido por credenciais, rede e criptografia do provedor.
- Registros de importação, mudanças de regras, cadastros e processamento compõem a trilha de alterações.
- SQL parametrizado. Sessões e controle de concorrência ficam no banco, inclusive no ambiente serverless.
- `.gitignore` e `.vercelignore` excluem os relatórios originais, dados locais, credenciais e exportações. Não crie links públicos para relatórios fiscais.
- O acesso de produção exige DATABASE_URL: o sistema bloqueia armazenamento no filesystem da Vercel.
- Guarde backup do PostgreSQL **e da DATA_ENCRYPTION_KEY**. Sem a chave, os originais não podem ser recuperados. Faça teste de restauração antes da operação de produção.

## Preparação para Vercel e GitHub

O repositório contém configuração Vercel e integração contínua GitHub Actions. O banco e os segredos devem ser configurados separadamente em cada ambiente.

1. Conecte o repositório GitHub escolhido e envie somente o código versionado. Cadastros, arquivos fiscais e credenciais permanecem fora do Git.
2. Crie um banco PostgreSQL gerenciado com TLS e backups. Use URL com pool compatível com o provedor.
3. Importe o repositório na Vercel como Next.js, com Node.js 22 ou 24.
4. Configure **DATABASE_URL**, **ADMIN_EMAIL**, **ADMIN_PASSWORD_HASH**, **DATA_ENCRYPTION_KEY** e **APP_ORIGIN** com a URL HTTPS exata da aplicação. Gere credenciais próprias de produção; não publique o arquivo local.
5. Rode a migração idempotente (`pnpm db:migrate`) apontando ao banco de produção antes de liberar o acesso. Na primeira inicialização, o mesmo esquema é assegurado pelo servidor.
6. Execute os testes e o build. Valide login, upload, processamento, backup e restauração no provedor escolhido.

O ambiente de preview deve ter banco, chave e credenciais separados da produção. APP_ORIGIN precisa corresponder ao domínio daquele ambiente. Não configurar uma origem arbitrária recebida do cliente.

A Vercel limita payloads de Functions a 4,5 MB. Esta versão limita o lote de upload a 3,5 MB e processa relatórios resumidos de forma síncrona. Resultados acima do limite da versão são bloqueados com mensagem explícita. Processamento massivo por item/documento precisará de armazenamento privado de objetos, filas, paginação e jobs; não é um importador de XML ou SPED completo. Limite atual do parser: 12.000 linhas por arquivo, sujeito ao limite de tamanho do resultado.

Referências técnicas: [Route Handlers do Next.js](https://nextjs.org/docs/app/getting-started/route-handlers), [persistência PGlite](https://pglite.dev/docs/filesystems), [limites de Functions da Vercel](https://vercel.com/docs/functions/limitations).

## Verificação

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm run verify:reports
node scripts/http-check.mjs
node scripts/integration-http.mjs
```

- Testes de parsing de crédito/débito, precisão, cadastros 0140, vigência, sobreposição, créditos, CFOPs e cruzamento NF-e.
- Banco de testes isolado: atomicidade, duplicidade, histórico, autenticação, criptografia e separação de competências.
- Teste de durabilidade local: encerramento abrupto e reabertura em outro processo.
- A verificação HTTP usa a instância local ativa, autentica e encerra uma sessão, confirma que o banco real está vazio na instalação inicial e valida exportações fictícias. Não cria dados fiscais reais.
- A validação de relatórios escreve apenas o diagnóstico em `.data/validacao-relatorios.json`.
- O teste opcional PostgreSQL usa TEST_DATABASE_URL; o CI fornece um banco descartável.
- Exportações fictícias de QA ficam em `.data/qa`.

Próximas etapas: validar a amostra detalhada Consinco, reconciliar LivroApu/OperInterUF, ampliar perfis e permissões, importar ajustes da apuração, adicionar processamento em fila e integrar PIS/COFINS.

Referência do catálogo de natureza: [Tabela CFOP da SEFAZ/PE](https://www.sefaz.pe.gov.br/Legislacao/Tributaria/Documents/Legislacao/Tabelas/CFOP.htm). A vigência e o fundamento tributário devem ser validados no cadastro de regras.

No Windows, o OneDrive pode marcar diretórios como somente leitura e impedir a reabertura do PostgreSQL incorporado. Mantenha o banco fora de pastas sincronizadas e faça backups com o banco fechado ou por exportação consistente. A pasta do código pode permanecer no OneDrive.
