import { createHash, randomBytes, scryptSync, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { database } from './db';
export class HttpError extends Error { constructor(message:string, public status=400){super(message);} }
export const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export function checkOrigin(req:Request) {
  const origin=process.env.APP_ORIGIN;
  if(!origin) throw new HttpError('Configure APP_ORIGIN antes de usar o ambiente real.',503);
  if(req.headers.get('origin')!==new URL(origin).origin) throw new HttpError('Origem da requisição não autorizada.',403);
}
export async function requireAuth(req:Request) {
  const cookie=req.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('mega_session='))?.slice(13);
  if(!cookie||!/^[a-f0-9]{64}$/.test(cookie)) throw new HttpError('Entre para acessar os dados reais.',401);
  const db=await database();
  const rows=await db.query('SELECT id FROM mega_sessions WHERE id=$1 AND expires_at>now()',[hash(cookie)]);
  if(!rows.length) throw new HttpError('Sessão expirada. Entre novamente.',401);
  return process.env.ADMIN_EMAIL||'admin';
}
export async function login(email:string,password:string) {
  const missing=['ADMIN_PASSWORD_HASH','DATA_ENCRYPTION_KEY'].filter(name=>!process.env[name]?.trim());
  if(missing.length) {
    const instruction=process.env.VERCEL
      ? 'Preencha essas variáveis no ambiente Production da Vercel, salve e faça um novo deploy.'
      : 'Configure essas variáveis no .env.local e reinicie o servidor.';
    throw new HttpError('Acesso não configurado: '+missing.join(', ')+'. '+instruction,503);
  }
  const db=await database();
  return db.transaction(async tx=>{
    await tx.query("INSERT INTO mega_login_limit(id,failures,reset_at) VALUES ('admin',0,now()+interval '15 minutes') ON CONFLICT DO NOTHING");
    const [limit]=await tx.query<{failures:number;reset_at:Date}>("SELECT * FROM mega_login_limit WHERE id='admin' FOR UPDATE");
    const expired=new Date(limit.reset_at).getTime()<Date.now();
    if(!expired&&limit.failures>=5) return {error:'Muitas tentativas. Aguarde 15 minutos.',status:429};
    const [salt,expected]=process.env.ADMIN_PASSWORD_HASH!.split(':');
    if(!salt||!expected||expected.length!==128) throw new HttpError('Hash de acesso inválido.',503);
    const actual=scryptSync(password,salt,64);
    const correct=timingSafeEqual(actual,Buffer.from(expected,'hex')) && email.toLowerCase()===(process.env.ADMIN_EMAIL||'').toLowerCase();
    if(!correct) {
      await tx.query("UPDATE mega_login_limit SET failures=$1, reset_at=$2 WHERE id='admin'",[expired?1:limit.failures+1,expired?new Date(Date.now()+900000):limit.reset_at]);
      return {error:'E-mail ou senha incorretos.',status:401};
    }
    await tx.query("UPDATE mega_login_limit SET failures=0 WHERE id='admin'");
    await tx.query('DELETE FROM mega_sessions WHERE expires_at<now()');
    const token=randomBytes(32).toString('hex');
    await tx.query('INSERT INTO mega_sessions(id,expires_at) VALUES ($1,$2)',[hash(token),new Date(Date.now()+8*3600000)]);
    return {token,status:200};
  });
}
export async function logout(req:Request) {
  const cookie=req.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('mega_session='))?.slice(13);
  if(cookie) await (await database()).query('DELETE FROM mega_sessions WHERE id=$1',[hash(cookie)]);
}
export function sessionCookie(token:string,maxAge=28800) {return 'mega_session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+maxAge+(process.env.APP_ORIGIN?.startsWith('https:')?'; Secure':'');}
function encryptionKey() {
  const key=process.env.DATA_ENCRYPTION_KEY;
  if(!key||!/^[a-f0-9]{64}$/.test(key)) throw new HttpError('Chave de criptografia não configurada.',503);
  return Buffer.from(key,'hex');
}
export function encrypt(bytes:Uint8Array) {
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);
  return Buffer.concat([iv,cipher.update(bytes),cipher.final(),cipher.getAuthTag()]).toString('base64');
}
export function decrypt(value:string) {
  const data=Buffer.from(value,'base64');
  const decipher=createDecipheriv('aes-256-gcm',encryptionKey(),data.subarray(0,12));
  decipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([decipher.update(data.subarray(12,-16)),decipher.final()]);
}
