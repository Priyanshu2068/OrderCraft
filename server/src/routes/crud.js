import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';

// Generic CRUD router for simple master-data tables.
// `schema` is a zod object; its keys are the writable columns.
export function crud({ table, schema, writeRoles, orderBy = 'id DESC' }) {
  const router = Router();
  const cols = Object.keys(schema.shape);
  const write = requireRole(...writeRoles);

  router.get('/', async (_req, res) => {
    const { rows } = await query(`SELECT * FROM ${table} ORDER BY ${orderBy}`);
    res.json(rows);
  });

  router.get('/:id', async (req, res) => {
    const { rows } = await query(`SELECT * FROM ${table} WHERE id = $1`, [req.params.id]);
    if (!rows[0]) throw new HttpError(404, 'Not found');
    res.json(rows[0]);
  });

  router.post('/', write, async (req, res) => {
    const data = schema.parse(req.body);
    const keys = cols.filter((c) => data[c] !== undefined);
    const { rows } = await query(
      `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
      keys.map((k) => data[k]));
    res.status(201).json(rows[0]);
  });

  router.put('/:id', write, async (req, res) => {
    const data = schema.partial().parse(req.body);
    const keys = cols.filter((c) => data[c] !== undefined);
    if (!keys.length) throw new HttpError(400, 'Nothing to update');
    const { rows } = await query(
      `UPDATE ${table} SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(',')} WHERE id = $${keys.length + 1} RETURNING *`,
      [...keys.map((k) => data[k]), req.params.id]);
    if (!rows[0]) throw new HttpError(404, 'Not found');
    res.json(rows[0]);
  });

  router.delete('/:id', write, async (req, res) => {
    const { rowCount } = await query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
    if (!rowCount) throw new HttpError(404, 'Not found');
    res.status(204).end();
  });

  return router;
}
