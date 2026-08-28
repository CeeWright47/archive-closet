import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'GET') {
    const rows = await sql`SELECT * FROM fits ORDER BY saved DESC`;
    return res.json(rows.map(r => ({ ...r, piece_ids: r.piece_ids ?? [] })));
  }

  if (req.method === 'POST') {
    const f = req.body;
    if (!f?.id) return res.status(400).json({ error: 'id required' });
    await sql`
      INSERT INTO fits (id, title, occasion, piece_ids, why, missing, saved)
      VALUES (
        ${f.id}, ${f.title ?? ''}, ${f.occasion ?? ''},
        ${JSON.stringify(f.piece_ids ?? [])}, ${f.why ?? ''},
        ${f.missing ?? null}, ${f.saved}
      )
      ON CONFLICT (id) DO NOTHING
    `;
    return res.status(201).json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
