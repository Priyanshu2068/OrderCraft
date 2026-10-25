import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, withTx } from '../db/pool.js';
import { requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';
import { createOrder, computePromise, confirmOrder, loadOrder } from '../services/orderService.js';
import { itemsSchema } from './orders.js';
import { sendInvoicePdf } from './operations.js';

// ---------- Customer self-service portal (role: customer) ----------
export const portalRouter = Router();

portalRouter.use((req, _res, next) => {
  if (req.user.role !== 'customer' || !req.user.customer_id) throw new HttpError(403, 'Customer portal only');
  next();
});

portalRouter.get('/catalog', async (_req, res) => {
  const { rows } = await query('SELECT id, sku, name, unit_price, lead_time_days FROM products ORDER BY name');
  res.json(rows);
});

portalRouter.post('/estimate', async (req, res) => {
  const items = itemsSchema.parse(req.body.items);
  const promise = await computePromise({ query }, items);
  // customers see the date and lead time, not our stock levels
  res.json({ date: promise.date, days: promise.days });
});

portalRouter.get('/orders', async (req, res) => {
  const { rows } = await query(
    `SELECT id, order_no, status, due_date, promised_date, total_amount, created_at FROM orders
     WHERE customer_id = $1 ORDER BY id DESC`, [req.user.customer_id]);
  res.json(rows);
});

portalRouter.get('/orders/:id', async (req, res) => {
  const order = await loadOrder({ query }, req.params.id, { staff: false, customerId: req.user.customer_id });
  delete order.promise; // internal blockers stay internal
  res.json(order);
});

// Customers can request a quote themselves.
portalRouter.post('/orders', async (req, res) => {
  const data = z.object({
    items: itemsSchema,
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  }).parse(req.body);
  const order = await withTx((db) => createOrder(db, {
    customer_id: req.user.customer_id, items: data.items, due_date: data.due_date,
    created_by: req.user.id, note: 'Quote requested by customer',
  }));
  res.status(201).json({ id: order.id, order_no: order.order_no });
});

portalRouter.post('/orders/:id/approve', async (req, res) => {
  await withTx(async (db) => {
    const { rows: [o] } = await db.query('SELECT customer_id, status FROM orders WHERE id = $1', [req.params.id]);
    if (!o || o.customer_id !== req.user.customer_id) throw new HttpError(404, 'Order not found');
    if (o.status !== 'quote') throw new HttpError(409, 'Only quotes can be approved');
    await confirmOrder(db, req.params.id, { actor: req.user.id, note: 'Quote approved by customer' });
  });
  res.json({ ok: true });
});

portalRouter.post('/orders/:id/cancel', async (req, res) => {
  await withTx(async (db) => {
    const { rows: [o] } = await db.query('SELECT customer_id, status FROM orders WHERE id = $1', [req.params.id]);
    if (!o || o.customer_id !== req.user.customer_id) throw new HttpError(404, 'Order not found');
    if (o.status !== 'quote') throw new HttpError(409, 'Only quotes can be cancelled online; contact us to change a confirmed order');
    await db.query(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [req.params.id]);
    await db.query(`INSERT INTO order_events (order_id, status, note, actor_id) VALUES ($1,'cancelled','Cancelled by customer',$2)`,
      [req.params.id, req.user.id]);
  });
  res.json({ ok: true });
});

// One-click reorder: copies the items into a fresh quote at today's prices.
portalRouter.post('/orders/:id/reorder', async (req, res) => {
  const order = await withTx(async (db) => {
    const { rows: [o] } = await db.query('SELECT customer_id FROM orders WHERE id = $1', [req.params.id]);
    if (!o || o.customer_id !== req.user.customer_id) throw new HttpError(404, 'Order not found');
    const { rows: items } = await db.query('SELECT product_id, qty FROM order_items WHERE order_id = $1', [req.params.id]);
    return createOrder(db, {
      customer_id: req.user.customer_id, items, created_by: req.user.id, note: 'Reorder of a previous order',
    });
  });
  res.status(201).json({ id: order.id, order_no: order.order_no });
});

portalRouter.get('/invoices', async (req, res) => {
  const { rows } = await query(
    `SELECT i.id, i.invoice_no, i.amount, i.due_date, i.status, o.order_no,
            COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid
     FROM invoices i JOIN orders o ON o.id = i.order_id WHERE o.customer_id = $1 ORDER BY i.id DESC`,
    [req.user.customer_id]);
  res.json(rows);
});

portalRouter.get('/invoices/:id/pdf', (req, res) => sendInvoicePdf(res, req.params.id, req.user.customer_id));

// ---------- Staff: give a customer a portal login ----------
export const portalAdminRouter = Router();

portalAdminRouter.post('/:id/portal-user', requireRole('sales'), async (req, res) => {
  const data = z.object({ email: z.string().email(), password: z.string().min(8) }).parse(req.body);
  const { rows: [c] } = await query('SELECT id, name FROM customers WHERE id = $1', [req.params.id]);
  if (!c) throw new HttpError(404, 'Customer not found');
  await query(
    `INSERT INTO users (name, email, password_hash, role, customer_id) VALUES ($1,$2,$3,'customer',$4)`,
    [c.name, data.email, bcrypt.hashSync(data.password, 10), c.id]);
  res.status(201).json({ ok: true });
});

// ---------- Public order tracking (no login; the unguessable token is the credential) ----------
export const trackRouter = Router();

trackRouter.get('/:token', async (req, res) => {
  const { rows: [o] } = await query(
    `SELECT o.id, o.order_no, o.status, o.due_date, o.promised_date, c.name AS customer_name
     FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.tracking_token = $1`, [req.params.token]);
  if (!o) throw new HttpError(404, 'Tracking link not found');
  const [events, shipments, items] = await Promise.all([
    query('SELECT status, created_at FROM order_events WHERE order_id = $1 ORDER BY id', [o.id]),
    query('SELECT carrier, tracking_no, shipped_at FROM shipments WHERE order_id = $1', [o.id]),
    query(`SELECT p.name, oi.qty FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = $1`, [o.id]),
  ]);
  const { id, ...pub } = o;
  res.json({ ...pub, events: events.rows, shipments: shipments.rows, items: items.rows });
});
