/**
 * Catálogo de natureza de operação, sem conclusão sobre incidência ou crédito.
 * Fonte pública consultada: tabela CFOP da SEFAZ/PE e tabela da Receita Federal.
 * A vigência da regra tributária continua dependendo do cadastro fiscal.
 */
export const TRANSFER_CATALOG_VERSION = '2026-09-03';
export const TRANSFER_CATALOG_SOURCE = 'https://www.sefaz.pe.gov.br/Legislacao/Tributaria/Documents/Legislacao/Tabelas/CFOP.htm';
export const TRANSFER_CFOPS: Record<string, { description: string; direction: 'entrada'|'saida'; scope:'interna'|'interestadual' }> = {
  '1152': {description:'Transferência para comercialização', direction:'entrada',scope:'interna'},
  '2152': {description:'Transferência para comercialização', direction:'entrada',scope:'interestadual'},
  '5152': {description:'Transferência de mercadoria adquirida ou recebida de terceiros', direction:'saida',scope:'interna'},
  '6152': {description:'Transferência de mercadoria adquirida ou recebida de terceiros', direction:'saida',scope:'interestadual'},
  '1409': {description:'Transferência para comercialização em operação com mercadoria sujeita ao regime de substituição tributária',direction:'entrada',scope:'interna'},
  '2409': {description:'Transferência para comercialização em operação com mercadoria sujeita ao regime de substituição tributária',direction:'entrada',scope:'interestadual'},
  '5409': {description:'Transferência de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária',direction:'saida',scope:'interna'},
  '6409': {description:'Transferência de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária',direction:'saida',scope:'interestadual'}
};
