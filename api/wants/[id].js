import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);
  const { id } = req.query;

  if (req.method === 'DELETE') {
    await sql`DELETE FROM wants WHERE id = ${id}`;
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
