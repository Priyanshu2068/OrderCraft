import { HttpError } from '../middleware/error.js';

// Status state machine: only these transitions are allowed, and only via the
// action endpoints (never by writing an arbitrary status).
export const TRANSITIONS = {
  quote: ['confirmed', 'cancelled'],
  draft: ['confirmed', 'cancelled'],
  confirmed: ['in_production', 'cancelled'],
  in_production: ['ready'],
  ready: ['shipped'],
  shipped: ['invoiced'],
  invoiced: ['paid'],
  paid: [],
  cancelled: [],
};

const PRE_PRODUCTION = ['quote', 'draft', 'confirmed'];
const DEFAULT_SUPPLIER_LEAD_DAYS = 14;

export async function logEvent(db, orderId, status, { actor = null, note = null } = {}) {
  await db.query('INSERT INTO order_events (order_id, status, note, actor_id) VALUES ($1,$2,$3,$4)',
    [orderId, status, note, actor]);
}

export async function setStatus(db, orderId, next, { expect, actor, note } = {}) {
  const { rows: [order] } = await db.query('SELECT id, status FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
  if (!order) throw new HttpError(404, 'Order not found');
  if (expect && order.status !== expect) throw new HttpError(409, `Order must be '${expect}' (is '${order.status}')`);
  if (!TRANSITIONS[order.status].includes(next))
    throw new HttpError(409, `Cannot move order from '${order.status}' to '${next}'`);
  await db.query('UPDATE orders SET status = $1 WHERE id = $2', [next, orderId]);
  await logEvent(db, orderId, next, { actor, note });
  return order;
}

/**
 * Material plan for a set of items. Stock is allocated first-come-first-served:
 * `reserved` is what earlier (lower id) confirmed / in-production orders have already claimed.
 */
export async function materialPlan(db, items, beforeId = 2147483647) {
  const { rows } = await db.query(
    `SELECT m.id AS material_id, m.code, m.name, m.uom, m.stock_qty, m.unit_cost, m.supplier_id,
            s.lead_time_days AS supplier_lead_days,
            SUM(i.qty * b.qty_per_unit) AS required,
            COALESCE((SELECT SUM(oi2.qty * b2.qty_per_unit)
                      FROM orders o2
                      JOIN order_items oi2 ON oi2.order_id = o2.id
                      JOIN bom_items b2 ON b2.product_id = oi2.product_id
                      WHERE b2.material_id = m.id AND o2.id < $2
                        AND o2.status IN ('confirmed','in_production')), 0) AS reserved
     FROM jsonb_to_recordset($1::jsonb) AS i(product_id int, qty int)
     JOIN bom_items b ON b.product_id = i.product_id
     JOIN materials m ON m.id = b.material_id
     LEFT JOIN suppliers s ON s.id = m.supplier_id
     GROUP BY m.id, s.lead_time_days
     ORDER BY m.code`, [JSON.stringify(items), beforeId]);
  return rows.map((r) => {
    const free = +(r.stock_qty - r.reserved).toFixed(3); // can be negative when earlier orders over-claimed stock
    return { ...r, available: Math.max(0, free), shortage: Math.max(0, +(r.required - free).toFixed(3)) };
  });
}

export async function orderBom(db, orderId) {
  const { rows: items } = await db.query('SELECT product_id, qty FROM order_items WHERE order_id = $1', [orderId]);
  return materialPlan(db, items, orderId);
}

/**
 * Promise date = today + product lead time + the longest wait to restock any short material.
 * Returns the blockers so the UI can explain *why* a date is what it is.
 */
export async function computePromise(db, items, beforeId) {
  const plan = await materialPlan(db, items, beforeId);
  const { rows: prods } = await db.query('SELECT lead_time_days FROM products WHERE id = ANY($1)',
    [items.map((i) => i.product_id)]);
  const production = Math.max(0, ...prods.map((p) => p.lead_time_days));
  const blockers = plan.filter((p) => p.shortage > 0).map((p) => ({
    code: p.code, name: p.name, shortage: p.shortage, uom: p.uom,
    wait_days: p.supplier_lead_days ?? DEFAULT_SUPPLIER_LEAD_DAYS,
  }));
  const materialWait = Math.max(0, ...blockers.map((b) => b.wait_days));
  const days = production + materialWait;
  const { rows: [{ date }] } = await db.query('SELECT (CURRENT_DATE + $1::int)::text AS date', [days]);
  return { date, days, production_days: production, material_wait_days: materialWait, blockers };
}

export async function promiseForOrder(db, orderId) {
  const { rows: items } = await db.query('SELECT product_id, qty FROM order_items WHERE order_id = $1', [orderId]);
  return computePromise(db, items, orderId);
}

export const money = (n) => Math.round(n * 100) / 100;

export function pricing(subtotal, discountPct, taxPct) {
  const discount = money((subtotal * discountPct) / 100);
  const net = money(subtotal - discount);
  const tax = money((net * taxPct) / 100);
  return { subtotal: money(subtotal), discount, net, tax, total: money(net + tax) };
}

export async function createOrder(db, { customer_id, due_date, items, discount_pct, tax_pct, created_by, note }) {
  const { rows: [customer] } = await db.query('SELECT id, discount_pct FROM customers WHERE id = $1', [customer_id]);
  if (!customer) throw new HttpError(400, 'Unknown customer');
  const ids = [...new Set(items.map((i) => i.product_id))];
  const { rows: prods } = await db.query('SELECT id, unit_price FROM products WHERE id = ANY($1)', [ids]);
  const prices = new Map(prods.map((p) => [p.id, p.unit_price]));
  if (prices.size !== ids.length) throw new HttpError(400, 'Unknown product in items');

  const d = discount_pct ?? customer.discount_pct;
  const t = tax_pct ?? 0;
  const p = pricing(items.reduce((s, i) => s + i.qty * prices.get(i.product_id), 0), d, t);
  const promise = await computePromise(db, items);

  const { rows: [order] } = await db.query(
    `INSERT INTO orders (customer_id, created_by, status, due_date, subtotal, discount_pct, tax_pct, total_amount, promised_date)
     VALUES ($1,$2,'quote',$3,$4,$5,$6,$7,$8) RETURNING *`,
    [customer_id, created_by ?? null, due_date || null, p.subtotal, d, t, p.total, promise.date]);
  for (const i of items)
    await db.query('INSERT INTO order_items (order_id, product_id, qty, unit_price) VALUES ($1,$2,$3,$4)',
      [order.id, i.product_id, i.qty, prices.get(i.product_id)]);
  await logEvent(db, order.id, 'quote', { actor: created_by, note: note || 'Quote created' });
  return order;
}

// Confirm a quote/draft; the promise date is re-computed against the stock position at confirmation.
export async function confirmOrder(db, orderId, { actor, note } = {}) {
  await setStatus(db, orderId, 'confirmed', { actor, note });
  const promise = await promiseForOrder(db, orderId);
  await db.query('UPDATE orders SET promised_date = $1 WHERE id = $2', [promise.date, orderId]);
  return promise;
}

/** Full order view. `staff: false` hides cost, margin, BOM and the internal audit actors. */
export async function loadOrder(db, id, { staff, customerId } = {}) {
  const { rows: [order] } = await db.query(
    `SELECT o.*, c.name AS customer_name FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = $1`, [id]);
  if (!order || (customerId && order.customer_id !== customerId)) throw new HttpError(404, 'Order not found');

  const [items, workOrders, shipments, invoice, events] = await Promise.all([
    db.query(`SELECT oi.*, p.sku, p.name FROM order_items oi JOIN products p ON p.id = oi.product_id
              WHERE oi.order_id = $1 ORDER BY oi.id`, [id]),
    db.query('SELECT * FROM work_orders WHERE order_id = $1 ORDER BY id', [id]),
    db.query('SELECT * FROM shipments WHERE order_id = $1 ORDER BY id', [id]),
    db.query('SELECT * FROM invoices WHERE order_id = $1', [id]),
    db.query(`SELECT e.status, e.note, e.created_at, u.name AS actor
              FROM order_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.order_id = $1 ORDER BY e.id`, [id]),
  ]);

  const result = {
    ...order,
    items: items.rows,
    work_orders: workOrders.rows,
    shipments: shipments.rows,
    invoice: invoice.rows[0] || null,
    events: events.rows.map((e) => (staff ? e : { ...e, actor: null })),
    pricing: pricing(order.subtotal, order.discount_pct, order.tax_pct),
  };
  if (PRE_PRODUCTION.includes(order.status)) result.promise = await promiseForOrder(db, id);

  if (!staff) {
    delete result.created_by;
    return result;
  }
  // actual material cost once consumed, otherwise the BOM estimate
  const { rows: [{ cost: actual }] } = await db.query(
    `SELECT COALESCE(SUM(-sm.qty_change * m.unit_cost), 0) AS cost FROM stock_movements sm
     JOIN materials m ON m.id = sm.material_id WHERE sm.reason = 'consumption' AND sm.ref_id = $1`, [id]);
  const cost = actual > 0 ? actual : (await orderBom(db, id)).reduce((s, b) => s + b.required * b.unit_cost, 0);
  result.pricing.material_cost = money(cost);
  result.pricing.cost_is_actual = actual > 0;
  result.pricing.margin = money(result.pricing.net - cost);
  result.pricing.margin_pct = result.pricing.net ? money((result.pricing.margin / result.pricing.net) * 100) : 0;
  return result;
}
