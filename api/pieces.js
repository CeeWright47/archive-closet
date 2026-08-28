import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'GET') {
    const rows = await sql`SELECT * FROM pieces ORDER BY added ASC`;
    return res.json(rows.map(r => ({ ...r, seasons: r.seasons ?? [] })));
  }

  if (req.method === 'POST') {
    const p = req.body;
    if (!p?.id || !p?.name) return res.status(400).json({ error: 'id and name required' });
    await sql`
      INSERT INTO pieces (id, name, category, color, material, vibe, seasons, image, added)
      VALUES (
        ${p.id}, ${p.name}, ${p.category ?? ''}, ${p.color ?? ''},
        ${p.material ?? ''}, ${p.vibe ?? ''}, ${JSON.stringify(p.seasons ?? [])},
        ${p.image ?? ''}, ${p.added}
      )
      ON CONFLICT (id) DO UPDATE SET
        name     = EXCLUDED.name,
        category = EXCLUDED.category,
        color    = EXCLUDED.color,
        material = EXCLUDED.material,
        vibe     = EXCLUDED.vibe,
        seasons  = EXCLUDED.seasons,
        image    = EXCLUDED.image
    `;
    return res.status(201).json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
