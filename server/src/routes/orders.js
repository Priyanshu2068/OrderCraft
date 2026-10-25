import { Router } from 'express';
import { z } from 'zod';
import { query, withTx } from '../db/pool.js';
import { requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';
import {
  setStatus, orderBom, computePromise, createOrder, confirmOrder, loadOrder,
} from '../services/orderService.js';

const router = Router();

export const itemsSchema = z.array(z.object({
  product_id: z.number().int().positive(),
  qty: z.number().int().positive(),
})).min(1);

const createSchema = z.object({
  customer_id: z.number().int().positive(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  discount_pct: z.number().min(0).max(100).optional(),
  tax_pct: z.number().min(0).max(100).optional(),
  items: itemsSchema,
});

router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT o.id, o.order_no, o.status, o.due_date, o.promised_date, o.total_amount, o.created_at,
            c.name AS customer_name,
            (o.status IN ('quote','draft','confirmed','in_production','ready')
              AND o.due_date IS NOT NULL AND o.promised_date > o.due_date) AS late_risk
     FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE ($1::text IS NULL OR o.status = $1) ORDER BY o.id DESC`, [req.query.status || null]);
  res.json(rows);
});

// "When can we deliver this?" without creating anything.
router.post('/estimate', async (req, res) => {
  const items = itemsSchema.parse(req.body.items);
  res.json(await computePromise({ query }, items));
});

router.get('/:id', async (req, res) => res.json(await loadOrder({ query }, req.params.id, { staff: true })));

router.get('/:id/bom', async (req, res) => res.json(await orderBom({ query }, req.params.id)));

router.post('/', requireRole('sales'), async (req, res) => {
  const data = createSchema.parse(req.body);
  const order = await withTx((db) => createOrder(db, { ...data, created_by: req.user.id }));
  res.status(201).json(order);
});

// Manual transitions: confirm or cancel only.
router.patch('/:id/status', requireRole('sales', 'planner'), async (req, res) => {
  const { status } = z.object({ status: z.enum(['confirmed', 'cancelled']) }).parse(req.body);
  await withTx((db) => (status === 'confirmed'
    ? confirmOrder(db, req.params.id, { actor: req.user.id })
    : setStatus(db, req.params.id, 'cancelled', { actor: req.user.id })));
  res.json({ ok: true });
});

// Start production: creates a work order, moves confirmed -> in_production.
router.post('/:id/work-orders', requireRole('planner'), async (req, res) => {
  const wo = await withTx(async (db) => {
    await setStatus(db, req.params.id, 'in_production', { expect: 'confirmed', actor: req.user.id });
    const short = (await orderBom(db, req.params.id)).filter((b) => b.shortage > 0);
    if (short.length) throw new HttpError(409, `Material shortage: ${short.map((s) => s.code).join(', ')}. Raise a purchase order first.`);
    const { rows: [w] } = await db.query(
      `INSERT INTO work_orders (order_id, status, start_date) VALUES ($1,'running',CURRENT_DATE) RETURNING *`, [req.params.id]);
    return w;
  });
  res.status(201).json(wo);
});

router.post('/:id/shipments', requireRole('warehouse'), async (req, res) => {
  const data = z.object({ carrier: z.string().min(1), tracking_no: z.string().optional() }).parse(req.body);
  const shipment = await withTx(async (db) => {
    await setStatus(db, req.params.id, 'shipped', {
      expect: 'ready', actor: req.user.id, note: `Shipped via ${data.carrier}${data.tracking_no ? ` (${data.tracking_no})` : ''}`,
    });
    const { rows: [s] } = await db.query(
      'INSERT INTO shipments (order_id, carrier, tracking_no) VALUES ($1,$2,$3) RETURNING *',
      [req.params.id, data.carrier, data.tracking_no || null]);
    return s;
  });
  res.status(201).json(shipment);
});

router.post('/:id/invoice', requireRole('finance'), async (req, res) => {
  const inv = await withTx(async (db) => {
    await setStatus(db, req.params.id, 'invoiced', { expect: 'shipped', actor: req.user.id });
    const { rows: [o] } = await db.query('SELECT total_amount FROM orders WHERE id = $1', [req.params.id]);
    const { rows: [i] } = await db.query(
      `INSERT INTO invoices (order_id, amount, due_date) VALUES ($1,$2,CURRENT_DATE + 30) RETURNING *`,
      [req.params.id, o.total_amount]);
    return i;
  });
  res.status(201).json(inv);
});

export default router;
