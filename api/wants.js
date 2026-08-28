import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'GET') {
    const rows = await sql`SELECT * FROM wants ORDER BY added DESC`;
    return res.status(200).json(rows);
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { id, item, reason, price, score, image, owned, added } = body;
    await sql`
      INSERT INTO wants (id, item, reason, price, score, image, owned, added)
      VALUES (${id}, ${item}, ${reason}, ${price}, ${score}, ${image}, ${owned ?? false}, ${added})
      ON CONFLICT (id) DO UPDATE
        SET item    = EXCLUDED.item,
            reason  = EXCLUDED.reason,
            price   = EXCLUDED.price,
            score   = EXCLUDED.score,
            image   = EXCLUDED.image,
            owned   = EXCLUDED.owned,
            added   = EXCLUDED.added
    `;
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
