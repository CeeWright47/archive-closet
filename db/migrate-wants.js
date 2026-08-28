import { Pool } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter(l => l.includes('='))
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);
const pool = new Pool({ connectionString: env.DATABASE_URL });
(async () => {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS wants (
      id     TEXT PRIMARY KEY,
      item   TEXT,
      reason TEXT,
      price  TEXT,
      score  INTEGER,
      image  TEXT,
      owned  BOOLEAN NOT NULL DEFAULT false,
      added  BIGINT  NOT NULL
    )`);
    console.log('wants table ready');
  } finally {
    client.release();
    await pool.end();
  }
})().catch(console.error);
