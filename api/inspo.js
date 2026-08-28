import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'GET') {
    const rows = await sql`SELECT * FROM inspo ORDER BY added ASC`;
    return res.json(rows);
  }

  if (req.method === 'POST') {
    const p = req.body;
    if (!p?.id) return res.status(400).json({ error: 'id required' });
    await sql`
      INSERT INTO inspo (id, vibe, image, added)
      VALUES (${p.id}, ${p.vibe ?? ''}, ${p.image ?? ''}, ${p.added})
      ON CONFLICT (id) DO UPDATE SET
        vibe  = EXCLUDED.vibe,
        image = EXCLUDED.image
    `;
    return res.status(201).json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
