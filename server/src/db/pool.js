import 'dotenv/config';
import pg from 'pg';

// Return NUMERIC as JS numbers (values here are well within double precision).
pg.types.setTypeParser(1700, (v) => parseFloat(v));
// Return DATE as 'YYYY-MM-DD' strings, not JS Dates.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export const query = (text, params) => pool.query(text, params);

export async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
