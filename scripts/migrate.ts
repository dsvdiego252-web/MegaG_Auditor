import { loadEnvFile } from 'node:process';
import { database } from '../lib/db';
try { loadEnvFile('.env.local'); } catch {}
const db = await database();
console.log('Estrutura PostgreSQL atualizada.');
await db.close();
