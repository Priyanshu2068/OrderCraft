import { Router } from 'express';
import { query } from '../db/pool.js';

const router = Router();

// Actual margin per order: net revenue vs. the materials really consumed (stock ledger x unit cost).
const MARGIN_SQL = `
  WITH cost AS (
    SELECT sm.ref_id AS order_id, SUM(-sm.qty_change * m.unit_cost) AS cost
    FROM stock_movements sm JOIN materials m ON m.id = sm.material_id
    WHERE sm.reason = 'consumption' GROUP BY sm.ref_id)
  SELECT o.id, o.order_no, c.name AS customer_name, o.status,
         ROUND(o.subtotal * (1 - o.discount_pct / 100), 2) AS revenue,
         ROUND(cost.cost, 2) AS cost,
         ROUND(o.subtotal * (1 - o.discount_pct / 100) - cost.cost, 2) AS margin
  FROM orders o JOIN cost ON cost.order_id = o.id JOIN customers c ON c.id = o.customer_id
  ORDER BY o.id DESC`;

router.get('/summary', async (_req, res) => {
  const [byStatus, lowStock, revenueByMonth, topProducts, pipeline, receivables, onTime, margins, late, overdue] =
    await Promise.all([
      query('SELECT status, count(*)::int AS count FROM orders GROUP BY status ORDER BY status'),
      query('SELECT id, code, name, stock_qty, reorder_level FROM materials WHERE stock_qty <= reorder_level ORDER BY code'),
      query(`SELECT to_char(date_trunc('month', paid_at), 'YYYY-MM') AS month, SUM(amount) AS revenue
             FROM payments GROUP BY 1 ORDER BY 1 DESC LIMIT 12`),
      query(`SELECT p.name, SUM(oi.qty)::int AS units, SUM(oi.qty * oi.unit_price) AS revenue
             FROM order_items oi JOIN products p ON p.id = oi.product_id JOIN orders o ON o.id = oi.order_id
             WHERE o.status NOT IN ('cancelled','quote','draft') GROUP BY p.id ORDER BY revenue DESC LIMIT 5`),
      query(`SELECT COALESCE(SUM(total_amount),0) AS value, count(*)::int AS count FROM orders
             WHERE status IN ('confirmed','in_production','ready','shipped')`),
      query(`SELECT COALESCE((SELECT SUM(amount) FROM invoices),0) - COALESCE((SELECT SUM(amount) FROM payments),0) AS value`),
      query(`SELECT count(*)::int AS total,
                    count(*) FILTER (WHERE s.shipped_at <= COALESCE(o.due_date, o.promised_date))::int AS on_time
             FROM orders o JOIN LATERAL (SELECT MIN(shipped_at) AS shipped_at FROM shipments WHERE order_id = o.id) s ON TRUE
             WHERE s.shipped_at IS NOT NULL AND COALESCE(o.due_date, o.promised_date) IS NOT NULL`),
      query(MARGIN_SQL),
      query(`SELECT o.id, o.order_no, c.name AS customer_name, o.due_date, o.promised_date, o.status
             FROM orders o JOIN customers c ON c.id = o.customer_id
             WHERE o.status IN ('quote','draft','confirmed','in_production','ready')
               AND o.due_date IS NOT NULL AND o.promised_date > o.due_date ORDER BY o.due_date`),
      query(`SELECT i.id, i.invoice_no, i.amount, i.due_date FROM invoices i
             WHERE i.status <> 'paid' AND i.due_date < CURRENT_DATE ORDER BY i.due_date`),
    ]);

  const rev = margins.rows.reduce((s, r) => s + r.revenue, 0);
  const mar = margins.rows.reduce((s, r) => s + r.margin, 0);
  const ot = onTime.rows[0];
  res.json({
    ordersByStatus: byStatus.rows,
    lowStock: lowStock.rows,
    revenueByMonth: revenueByMonth.rows.reverse(),
    topProducts: topProducts.rows,
    revenue: revenueByMonth.rows.reduce((s, r) => s + r.revenue, 0),
    pipeline: pipeline.rows[0],
    receivables: receivables.rows[0].value,
    onTimePct: ot.total ? Math.round((ot.on_time / ot.total) * 100) : null,
    marginPct: rev ? Math.round((mar / rev) * 1000) / 10 : null,
    lateRisk: late.rows,
    overdueInvoices: overdue.rows,
  });
});

router.get('/profitability', async (_req, res) => res.json((await query(MARGIN_SQL)).rows));

// Reorder suggestions: projected stock = on hand - committed to open orders + already on order.
router.get('/reorder-suggestions', async (_req, res) => {
  const { rows } = await query(
    `SELECT m.id, m.code, m.name, m.uom, m.stock_qty, m.reorder_level, m.unit_cost, m.supplier_id,
            s.name AS supplier_name, s.lead_time_days,
            COALESCE((SELECT SUM(oi.qty * b.qty_per_unit) FROM orders o
                      JOIN order_items oi ON oi.order_id = o.id JOIN bom_items b ON b.product_id = oi.product_id
                      WHERE b.material_id = m.id AND o.status IN ('confirmed','in_production')), 0) AS committed,
            COALESCE((SELECT SUM(pi.qty) FROM po_items pi JOIN purchase_orders po ON po.id = pi.po_id
                      WHERE pi.material_id = m.id AND po.status = 'open'), 0) AS on_order
     FROM materials m LEFT JOIN suppliers s ON s.id = m.supplier_id ORDER BY m.code`);
  res.json(rows
    .map((m) => ({ ...m, projected: +(m.stock_qty - m.committed + m.on_order).toFixed(3) }))
    .filter((m) => m.projected < m.reorder_level)
    // order back up to twice the reorder level
    .map((m) => ({ ...m, suggested_qty: Math.ceil(m.reorder_level * 2 - m.projected), est_cost: Math.ceil(m.reorder_level * 2 - m.projected) * m.unit_cost })));
});

// Production schedule: open orders with start (created) -> promised/due dates.
router.get('/schedule', async (_req, res) => {
  const { rows } = await query(
    `SELECT o.id, o.order_no, o.status, c.name AS customer_name, o.created_at::date::text AS start_date,
            o.due_date, o.promised_date,
            (o.due_date IS NOT NULL AND o.promised_date > o.due_date) AS late_risk
     FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE o.status IN ('confirmed','in_production','ready') ORDER BY COALESCE(o.promised_date, o.due_date), o.id`);
  res.json(rows);
});

router.get('/orders.csv', async (_req, res) => {
  const { rows } = await query(
    `SELECT o.order_no, c.name AS customer, o.status, o.created_at::date::text AS created, o.due_date,
            o.promised_date, o.subtotal, o.discount_pct, o.tax_pct, o.total_amount
     FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id`);
  const cols = ['order_no', 'customer', 'status', 'created', 'due_date', 'promised_date', 'subtotal', 'discount_pct', 'tax_pct', 'total_amount'];
  const esc = (v) => (v == null ? '' : `"${String(v).replaceAll('"', '""')}"`);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
  res.send([cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'));
});

export default router;
