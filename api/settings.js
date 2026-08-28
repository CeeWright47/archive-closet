import { neon } from '@neondatabase/serverless';

// Allowed setting keys — guards against arbitrary key injection
const ALLOWED_KEYS = new Set(['style-profile', 'style-assessment', 'closet-gaps']);

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'GET') {
    const { key } = req.query;
    if (!key || !ALLOWED_KEYS.has(key)) return res.status(400).json({ error: 'invalid key' });
    const rows = await sql`SELECT value FROM settings WHERE key = ${key}`;
    return res.json({ value: rows[0]?.value ?? null });
  }

  if (req.method === 'PUT') {
    const { key, value } = req.body ?? {};
    if (!key || !ALLOWED_KEYS.has(key)) return res.status(400).json({ error: 'invalid key' });
    if (value === undefined) return res.status(400).json({ error: 'value required' });
    await sql`
      INSERT INTO settings (key, value) VALUES (${key}, ${value})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `;
    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
