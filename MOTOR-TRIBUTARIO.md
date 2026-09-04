# Motor tributário

A tela **Regras fiscais → Motor tributário** mantém o pacote recebido, suas referências e as verificações de ICMS. A classificação e a permissão de crédito por CFOP continuam no cadastro existente. Uma verificação adicional não concede crédito nem altera valores da origem.

## Importar e configurar

1. No ambiente real, importe o `motor-tributario.json` contido no pacote. O endpoint autenticado aceita até 256 KB. Não envie o ZIP à tela de relatórios do Consinco.
2. As referências entram **pendentes**. O mesmo conteúdo, identificado por SHA-256, não é duplicado. Um pacote diferente é preservado separadamente e também entra pendente, sem substituir regras validadas.
3. Abra **Revisar critérios**. Informe condições de aplicação, vigência, fundamento e justificativa. Cadastre os valores a conferir e a explicação de cada alerta.
4. A equipe fiscal pode marcar uma verificação de **ICMS** como validada quando esses critérios estiverem completos. PIS/COFINS, IBS/CBS e roteiros procedimentais são referências para fases futuras.
5. Reprocesse a competência. Alterar uma regra não muda retroativamente um resultado já processado.

As condições são cumulativas (AND). Uma lista de códigos admite qualquer valor da lista. Descrições aceitam expressões obrigatórias ou excluídas, com normalização de acentos e caixa. Código completo, como NCM ou CST, preserva zeros iniciais. Não há inferência do enquadramento por similaridade de produtos.

As verificações aceitam uma lista de códigos, igualdade numérica ou faixa inclusiva. Na edição do motor, use ponto decimal e ponto e vírgula para separar valores. Valores monetários são expressos em reais; percentuais são os percentuais informados no documento. Conferência de crédito deve delimitar o sentido de entrada e demais condições pertinentes à operação.

## Evidência e limites

- Sem campo exigido ou com vigência parcial no mês sem data do lançamento: **Revisar**, identificando o que falta.
- Mais de uma regra candidata para o mesmo campo: **Revisar**, sem escolher silenciosamente uma delas.
- Divergência: alerta com o valor informado, o esperado, a explicação, a prioridade, o fundamento e a versão.
- Resultado OK significa apenas que o critério cadastrado foi atendido. A classificação integral continua sujeita às regras por CFOP e à cobertura documental.
- Alíquota não é inferida de imposto/base. Imposto com mapeamento pendente não é evidência para conferência de crédito/débito.
- Referências históricas ou instruções em linguagem natural não se tornam regras executáveis na importação. Seu conteúdo é preservado para a revisão fiscal.
- Não há novo leitor de XML ou SPED nesta entrega. Os roteiros recebidos ficam catalogados. A importação funcional continua pelo layout TXT/CSV do ICMS.

## Dados adicionais no relatório

O parser preserva o TXT/CSV original e reconhece, opcionalmente, `NCM` (8 dígitos), `CEST` (7), `CST ICMS` (2 ou 3 conforme informado), `CSOSN` (3), `cBenef`, `Descrição do Produto`, `Alíquota ICMS`, `MVA`, `CNAE` (7), `Regime Tributário`, `UF Origem` e `UF Destino`.

Percentuais no arquivo usam vírgula decimal, sem `%`. Não converter um relatório resumido por CFOP em detalhe por produto preenchendo dados presumidos. Quando a origem for agregada, critérios que precisem de item ficarão pendentes. CNAE e regime da empresa também podem ser cadastrados em **Empresas do grupo**.

## Persistência e segurança

`mega_tax_packages` armazena metadados, hash e fonte JSON criptografada; `mega_tax_rules` mantém a versão atual; `mega_tax_revisions` preserva cada versão. Importação e edição são transacionais e registram responsável em `mega_events`. A edição exige a versão lida, rejeitando atualização concorrente com HTTP 409.

O snapshot guarda as regras e pacotes usados naquele processamento. O Excel inclui evidências, versões e hashes dos pacotes. O relatório de auditoria inclui as verificações e explicações com vínculo à linha original.

Pacotes reais, arquivos fiscais e credenciais ficam fora do Git. Os testes usam referências e bancos fictícios isolados. O JSON original pode ser baixado apenas por sessão autenticada. O modo demonstração não acessa o catálogo real.
