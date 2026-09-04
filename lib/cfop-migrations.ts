export const CFOP_MIGRATIONS=[
`CREATE TABLE IF NOT EXISTS cfop_master_rules (
 id text PRIMARY KEY, cfop text NOT NULL CHECK (cfop ~ '^[123567][0-9]{3}$'), descricao_oficial text NOT NULL, grupo_cfop text NOT NULL,
 tipo_movimento text NOT NULL, ambito_operacao text NOT NULL, natureza_operacao text NOT NULL, empresa text NOT NULL, uf_aplicacao text NOT NULL,
 vigencia_inicial text NOT NULL, vigencia_final text, classificacao_valor_contabil text NOT NULL,
 permissao_credito_icms text NOT NULL, gera_debito_icms text NOT NULL, alertar_base_sem_credito boolean NOT NULL,
 tratar_como_faturamento boolean NOT NULL, tratar_como_compra boolean NOT NULL, tratar_como_transferencia boolean NOT NULL,
 tratar_como_devolucao boolean NOT NULL, tratar_como_remessa boolean NOT NULL, tratar_como_retorno boolean NOT NULL,
 impacta_faturamento text NOT NULL, impacta_compras text NOT NULL, motivo_condicoes text NOT NULL, fundamento_legal text NOT NULL,
 fonte text NOT NULL, prioridade integer NOT NULL, ativo boolean NOT NULL, versao integer NOT NULL,
 seed_version text NOT NULL, source_hash text NOT NULL, data_fonte text NOT NULL, grupo_oficial text NOT NULL
)`,
'CREATE INDEX IF NOT EXISTS cfop_master_lookup ON cfop_master_rules(cfop,vigencia_inicial,vigencia_final)',
'CREATE TABLE IF NOT EXISTS cfop_master_history (rule_id text NOT NULL, version integer NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(rule_id,version))',
'CREATE TABLE IF NOT EXISTS mega_audit_settings (id text PRIMARY KEY, version integer NOT NULL, payload jsonb NOT NULL)'
];
