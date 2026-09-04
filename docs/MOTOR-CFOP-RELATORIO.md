# Relatório de implantação — Motor de CFOP

Gerado em 04/09/2026 para a primeira fase de ICMS do Mega G — Auditor Fiscal.

## Fonte e cobertura

- **619 CFOPs vigentes** e **620 versões com vigência**, pois o CFOP 7667 preserva a redação anterior e a atual.
- Fonte da verdade: [Convênio s/nº de 15/12/1970 — Anexo II, consolidação do CONFAZ](https://www.confaz.fazenda.gov.br/legislacao/ajustes/sinief/cfop_cvsn_1-6.24).
- Versão da base: `2026-09-04-confaz-03-24-39-25`; SHA-256 da fonte: `51d12b7f9e1c2f08b9665a06875a64737726ce4a633138f437a90e431eb659e0`.
- EFD ICMS/IPI: [Guia Prático 3.2.2, vigente para o leiaute 020 em 2026](https://sped.rfb.gov.br/arquivo/download/8112). A versão 3.2.3 já publicada produz efeitos a partir de janeiro de 2027 e o sistema bloqueia o leiaute 021 até a atualização do adaptador.

## Regras automáticas

O primeiro dígito define entrada/saída e abrangência interna, interestadual ou exterior. A descrição oficial define a natureza e o grupo operacional. Crédito e débito não são concluídos pelo CFOP: **542 CFOPs são condicionais** e **77 ficam em Revisar**. A classificação monetária acontece por lançamento e preserva, simultaneamente, parcelas tributadas, isentas/não tributadas, ST, outras e diferença de reconciliação.

| Grupo | CFOPs vigentes |
|---|---:|
| DEVOLUCAO | 116 |
| OUTRAS | 77 |
| RETORNO | 62 |
| VENDA | 46 |
| TRANSFERENCIA | 45 |
| REMESSA | 42 |
| ENERGIA | 41 |
| TRANSPORTE | 34 |
| COMUNICACAO | 29 |
| COMPRA | 26 |
| SUBSTITUICAO_TRIBUTARIA | 22 |
| CONSIGNACAO | 18 |
| ARMAZEM_DEPOSITO | 14 |
| ATIVO_IMOBILIZADO | 9 |
| IMPORTACAO | 9 |
| INDUSTRIALIZACAO | 8 |
| EXPORTACAO | 6 |
| USO_CONSUMO | 5 |
| BONIFICACAO | 4 |
| DEMONSTRACAO | 4 |
| PERDA_BAIXA | 2 |

## Parametrização fiscal adicional

Os 77 códigos abaixo pertencem ao grupo OUTRAS ou não permitem uma expectativa segura a partir da descrição. Permanecem em **Revisar** até uma regra validada informar CST/CSOSN, NCM, CEST, finalidade, UF, regime, benefício/cBenef, valores e vigência aplicáveis.

1131, 1132, 1135, 1159, 1451, 1452, 1456, 1501, 1503, 1504, 1505, 1506, 1601, 1602, 1605, 1663, 1901, 1903, 1908, 1911, 1915, 1920, 1922, 1923, 1924, 1926, 1933, 1949, 2131, 2132, 2135, 2159, 2451, 2452, 2456, 2501, 2503, 2504, 2505, 2506, 2663, 2901, 2903, 2908, 2911, 2915, 2920, 2922, 2923, 2924, 2933, 2949, 3667, 3930, 3949, 5132, 5159, 5160, 5456, 5606, 5922, 5926, 5929, 5933, 5949, 6132, 6159, 6160, 6456, 6922, 6929, 6933, 6949, 7501, 7504, 7667, 7949.

Mesmo os códigos condicionais podem exigir uma exceção fiscal específica para a empresa, UF e período. A ordem aplicada é: empresa + UF + período; empresa; UF; CFOP; padrão do grupo; Revisar. Empates no mesmo nível não são decididos automaticamente. As exceções manuais existentes são preservadas, versionadas pelos eventos e registradas no snapshot de cada processamento.

## Dados e reconciliação

- Consinco: usa as colunas monetárias originais e aceita parcelas adicionais quando estiverem presentes.
- EFD ICMS/IPI: C190 é a fonte de total por CST + CFOP + alíquota; C100 e C170 são evidências hierárquicas e não são somados aos totais.
- A conferência ocorre em registro/item, documento, CFOP + CST + alíquota, empresa, competência e apuração E110 quando disponível.
- Valores originais nunca são rateados nem completados para forçar fechamento. ST exige contexto compatível, posição na cadeia e evidências.
- PIS/COFINS e leiaute EFD 021 permanecem fora desta etapa; arquivos incompatíveis são recusados em vez de serem interpretados como ICMS.

## Parâmetros iniciais configuráveis

- Tolerância absoluta: R$ 0,01.
- Tolerância percentual: 0,01%.
- Crítico absoluto: R$ 100,00.
- Crítico percentual: 1%.

Uma diferença só fica dentro da tolerância quando atende simultaneamente aos limites absoluto e percentual. Basta atingir um limite crítico para elevar a prioridade.

## Validação executada

A suíte executa 51 casos: 50 aprovados e 1 integração PostgreSQL externa ignorada no ambiente local. Os casos cobrem catálogo/vigência, 1101/2101, 1102/2102, compras e vendas ST, 5101/6101, 5102/6102, transferências, devoluções, remessas, retornos, ativo, uso e consumo, perda/baixa, abrangência por UF, classificação mista, tolerância, reconciliação, prioridade manual, importação Consinco, EFD C100/C170/C190/E110, segurança, persistência e exportação. O build de produção é validado separadamente antes da publicação.
