// Somente mensagens fixas: erros do driver podem conter a URL, usuário ou SQL.
const messages:Record<string,string>={
  '28P01':'O banco recusou a autenticação. Confira o usuário e a senha do banco dentro de DATABASE_URL.',
  '28000':'O banco recusou a autorização da conexão. Confira o usuário, a senha e as permissões da conexão.',
  '3D000':'O banco indicado na conexão não existe. Confira o nome do banco no final de DATABASE_URL.',
  '42501':'O usuário da conexão não possui as permissões necessárias para preparar ou acessar as tabelas do sistema.',
  '53300':'O banco atingiu o limite de conexões. Confira o pool de conexões e tente novamente.',
  ENOTFOUND:'O endereço do banco não foi encontrado. Confira o host de DATABASE_URL com a conexão fornecida pelo Supabase.',
  EAI_AGAIN:'A consulta do endereço do banco falhou temporariamente. Tente novamente em instantes.',
  ECONNREFUSED:'O banco recusou a conexão. Confira se o projeto está ativo e se o endereço e a porta estão corretos.',
  ECONNRESET:'A conexão com o banco foi interrompida. Confira o estado do projeto e tente novamente.',
  ETIMEDOUT:'O banco não respondeu a tempo. Confira o estado do projeto e a conexão de DATABASE_URL.',
  ENETUNREACH:'A rede do banco não está acessível. No Supabase, confira se foi copiada a conexão Shared pooler compatível com IPv4.',
  EHOSTUNREACH:'O servidor do banco não está acessível pela rede. Confira a conexão Shared pooler do Supabase.',
  ERR_INVALID_URL:'DATABASE_URL não contém uma conexão PostgreSQL válida. Confira o endereço completo e a codificação da senha.',
  SELF_SIGNED_CERT_IN_CHAIN:'Não foi possível validar o certificado SSL do banco. Configure o certificado CA fornecido pelo provedor.',
  DEPTH_ZERO_SELF_SIGNED_CERT:'Não foi possível validar o certificado SSL do banco. Configure o certificado CA fornecido pelo provedor.',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE:'Não foi possível validar a cadeia do certificado SSL do banco. Confira o certificado CA do provedor.',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY:'O certificado CA do banco não está disponível para validar a conexão SSL.',
  ERR_TLS_CERT_ALTNAME_INVALID:'O certificado SSL não corresponde ao endereço do banco. Confira o host de DATABASE_URL.',
  CERT_HAS_EXPIRED:'O certificado SSL do banco está vencido. Confira a situação do certificado com o provedor.',
};
export type DatabaseDiagnostic={code:string;message:string};
export function databaseDiagnostic(error:unknown,depth=0):DatabaseDiagnostic|null {
  if(!error||typeof error!=='object'||depth>4) return null;
  const item=error as {code?:unknown;message?:unknown;cause?:unknown;errors?:unknown};
  if(typeof item.code==='string'&&Object.hasOwn(messages,item.code)) return {code:item.code,message:messages[item.code]};
  if(typeof item.message==='string') {
    if(item.message==='Configure DATABASE_URL para usar dados reais em produção.') return {code:'DATABASE_URL_MISSING',message:'DATABASE_URL está ausente nesta publicação. Configure a conexão PostgreSQL no ambiente Production da Vercel.'};
    if(item.message.includes('Tenant or user not found')) return {code:'DATABASE_POOLER_USER',message:'O pooler não encontrou o projeto ou usuário informado. Copie novamente a conexão Shared pooler do seu projeto Supabase.'};
    if(item.message.startsWith('SASL:')&&item.message.includes('client password must be')) return {code:'DATABASE_PASSWORD_MISSING',message:'A conexão PostgreSQL está sem senha válida. Preencha a senha do banco no lugar de [YOUR-PASSWORD] em DATABASE_URL.'};
    if(item.message==='Connection terminated due to connection timeout'||item.message==='timeout exceeded when trying to connect') return {code:'DATABASE_TIMEOUT',message:messages.ETIMEDOUT};
  }
  const cause=databaseDiagnostic(item.cause,depth+1);
  if(cause) return cause;
  if(Array.isArray(item.errors)) {
    for(const child of item.errors.slice(0,8)) {
      const diagnostic=databaseDiagnostic(child,depth+1);
      if(diagnostic) return diagnostic;
    }
  }
  return null;
}
