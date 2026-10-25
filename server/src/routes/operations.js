import { Router } from 'express';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { query, withTx } from '../db/pool.js';
import { requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';
import { orderBom, setStatus } from '../services/orderService.js';

// ---------- Product BOM ----------
export const bomRouter = Router();

bomRouter.get('/:id/bom', async (req, res) => {
  const { rows } = await query(
    `SELECT b.id, b.material_id, b.qty_per_unit, m.code, m.name, m.uom
     FROM bom_items b JOIN materials m ON m.id = b.material_id WHERE b.product_id = $1 ORDER BY m.code`,
    [req.params.id]);
  res.json(rows);
});

// Replace the whole BOM for a product.
bomRouter.put('/:id/bom', requireRole('planner'), async (req, res) => {
  const items = z.array(z.object({
    material_id: z.number().int().positive(),
    qty_per_unit: z.number().positive(),
  })).parse(req.body);
  await withTx(async (db) => {
    await db.query('DELETE FROM bom_items WHERE product_id = $1', [req.params.id]);
    for (const i of items)
      await db.query('INSERT INTO bom_items (product_id, material_id, qty_per_unit) VALUES ($1,$2,$3)',
        [req.params.id, i.material_id, i.qty_per_unit]);
  });
  res.json({ ok: true });
});

// ---------- Work orders ----------
export const workOrderRouter = Router();

// Completing a work order consumes materials (ledger + stock) and marks the order ready.
workOrderRouter.patch('/:id', requireRole('planner', 'warehouse'), async (req, res) => {
  z.object({ status: z.literal('done') }).parse(req.body);
  await withTx(async (db) => {
    const { rows: [wo] } = await db.query('SELECT * FROM work_orders WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!wo) throw new HttpError(404, 'Work order not found');
    if (wo.status === 'done') throw new HttpError(409, 'Work order already completed');
    await setStatus(db, wo.order_id, 'ready', { expect: 'in_production', actor: req.user.id, note: 'Production completed' });
    for (const m of await orderBom(db, wo.order_id)) {
      // stock_qty has CHECK >= 0, so a concurrent shortage aborts the transaction
      const { rowCount } = await db.query(
        'UPDATE materials SET stock_qty = stock_qty - $1 WHERE id = $2 AND stock_qty >= $1', [m.required, m.material_id]);
      if (!rowCount) throw new HttpError(409, `Insufficient stock for ${m.code}`);
      await db.query(
        `INSERT INTO stock_movements (material_id, qty_change, reason, ref_id) VALUES ($1,$2,'consumption',$3)`,
        [m.material_id, -m.required, wo.order_id]);
    }
    await db.query(`UPDATE work_orders SET status='done', end_date=CURRENT_DATE WHERE id=$1`, [wo.id]);
  });
  res.json({ ok: true });
});

// ---------- Purchase orders ----------
export const purchaseRouter = Router();

purchaseRouter.get('/', async (_req, res) => {
  const { rows } = await query(
    `SELECT po.*, s.name AS supplier_name,
       COALESCE(json_agg(json_build_object('material_id', pi.material_id, 'code', m.code, 'name', m.name,
         'qty', pi.qty, 'unit_cost', pi.unit_cost)) FILTER (WHERE pi.id IS NOT NULL), '[]') AS items
     FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
     LEFT JOIN po_items pi ON pi.po_id = po.id LEFT JOIN materials m ON m.id = pi.material_id
     GROUP BY po.id, s.name ORDER BY po.id DESC`);
  res.json(rows);
});

// Draft one PO per supplier from an order's shortages.
purchaseRouter.post('/from-order/:orderId', requireRole('planner', 'warehouse'), async (req, res) => {
  const created = await withTx(async (db) => {
    const short = (await orderBom(db, req.params.orderId)).filter((b) => b.shortage > 0);
    if (!short.length) throw new HttpError(409, 'No shortages for this order');
    if (short.some((s) => !s.supplier_id)) throw new HttpError(409, 'A short material has no supplier assigned');
    const bySupplier = new Map();
    for (const s of short) bySupplier.set(s.supplier_id, [...(bySupplier.get(s.supplier_id) || []), s]);
    const pos = [];
    for (const [supplierId, lines] of bySupplier) {
      const { rows: [sup] } = await db.query('SELECT lead_time_days FROM suppliers WHERE id = $1', [supplierId]);
      const { rows: [po] } = await db.query(
        `INSERT INTO purchase_orders (supplier_id, expected_date) VALUES ($1, CURRENT_DATE + $2::int) RETURNING *`,
        [supplierId, sup.lead_time_days]);
      for (const l of lines)
        await db.query('INSERT INTO po_items (po_id, material_id, qty, unit_cost) VALUES ($1,$2,$3,$4)',
          [po.id, l.material_id, l.shortage, l.unit_cost]);
      pos.push(po);
    }
    return pos;
  });
  res.status(201).json(created);
});

purchaseRouter.post('/:id/receive', requireRole('warehouse', 'planner'), async (req, res) => {
  await withTx(async (db) => {
    const { rows: [po] } = await db.query('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!po) throw new HttpError(404, 'Purchase order not found');
    if (po.status === 'received') throw new HttpError(409, 'Already received');
    const { rows: items } = await db.query('SELECT * FROM po_items WHERE po_id = $1', [po.id]);
    for (const i of items) {
      await db.query('UPDATE materials SET stock_qty = stock_qty + $1 WHERE id = $2', [i.qty, i.material_id]);
      await db.query(`INSERT INTO stock_movements (material_id, qty_change, reason, ref_id) VALUES ($1,$2,'receipt',$3)`,
        [i.material_id, i.qty, po.id]);
    }
    await db.query(`UPDATE purchase_orders SET status = 'received' WHERE id = $1`, [po.id]);
  });
  res.json({ ok: true });
});

// ---------- Invoices & payments ----------
export const invoiceRouter = Router();

invoiceRouter.get('/', async (_req, res) => {
  const { rows } = await query(
    `SELECT i.*, o.order_no, c.name AS customer_name,
       COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid
     FROM invoices i JOIN orders o ON o.id = i.order_id JOIN customers c ON c.id = o.customer_id
     ORDER BY i.id DESC`);
  res.json(rows);
});

invoiceRouter.post('/:id/payments', requireRole('finance'), async (req, res) => {
  const data = z.object({ amount: z.number().positive(), method: z.string().optional() }).parse(req.body);
  const result = await withTx(async (db) => {
    const { rows: [inv] } = await db.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!inv) throw new HttpError(404, 'Invoice not found');
    const { rows: [{ paid }] } = await db.query('SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE invoice_id = $1', [inv.id]);
    const balance = +(inv.amount - paid).toFixed(2);
    if (data.amount > balance) throw new HttpError(400, `Payment exceeds balance (${balance})`);
    await db.query('INSERT INTO payments (invoice_id, amount, method) VALUES ($1,$2,$3)', [inv.id, data.amount, data.method || null]);
    const fullyPaid = Math.abs(data.amount - balance) < 0.005;
    await db.query('UPDATE invoices SET status = $1 WHERE id = $2', [fullyPaid ? 'paid' : 'partial', inv.id]);
    if (fullyPaid) await setStatus(db, inv.order_id, 'paid', { expect: 'invoiced', actor: req.user.id, note: 'Invoice fully paid' });
    return { status: fullyPaid ? 'paid' : 'partial', balance: +(balance - data.amount).toFixed(2) };
  });
  res.status(201).json(result);
});

export async function sendInvoicePdf(res, invoiceId, customerId) {
  const { rows: [inv] } = await query(
    `SELECT i.*, o.order_no, o.customer_id, o.discount_pct, o.tax_pct, o.subtotal, c.name AS customer_name
     FROM invoices i JOIN orders o ON o.id = i.order_id JOIN customers c ON c.id = o.customer_id WHERE i.id = $1`,
    [invoiceId]);
  if (!inv || (customerId && inv.customer_id !== customerId)) throw new HttpError(404, 'Invoice not found');
  const { rows: items } = await query(
    `SELECT p.sku, p.name, oi.qty, oi.unit_price FROM order_items oi JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1`, [inv.order_id]);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${inv.invoice_no}.pdf"`);
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);
  doc.fontSize(20).text('OrderCraft Invoice');
  doc.fontSize(11).moveDown().text(`Invoice: ${inv.invoice_no}    Order: ${inv.order_no}`)
    .text(`Customer: ${inv.customer_name}`).text(`Due: ${inv.due_date}`).moveDown();
  for (const i of items)
    doc.text(`${i.sku}  ${i.name}  x${i.qty} @ ${i.unit_price.toFixed(2)} = ${(i.qty * i.unit_price).toFixed(2)}`);
  doc.moveDown().text(`Subtotal: ${inv.subtotal.toFixed(2)}`);
  if (inv.discount_pct > 0) doc.text(`Discount: ${inv.discount_pct}%`);
  if (inv.tax_pct > 0) doc.text(`Tax: ${inv.tax_pct}%`);
  doc.moveDown().fontSize(13).text(`Total: ${inv.amount.toFixed(2)}`);
  doc.end();
}

invoiceRouter.get('/:id/pdf', (req, res) => sendInvoicePdf(res, req.params.id));

// Create one PO per supplier from reorder suggestions: [{ material_id, qty }]
purchaseRouter.post('/from-suggestions', requireRole('planner', 'warehouse'), async (req, res) => {
  const items = z.array(z.object({ material_id: z.number().int().positive(), qty: z.number().positive() })).min(1)
    .parse(req.body.items);
  const created = await withTx(async (db) => {
    const { rows: mats } = await db.query('SELECT id, supplier_id, unit_cost FROM materials WHERE id = ANY($1)',
      [items.map((i) => i.material_id)]);
    const byId = new Map(mats.map((m) => [m.id, m]));
    const bySupplier = new Map();
    for (const i of items) {
      const m = byId.get(i.material_id);
      if (!m) throw new HttpError(400, 'Unknown material');
      if (!m.supplier_id) throw new HttpError(409, 'A selected material has no supplier assigned');
      bySupplier.set(m.supplier_id, [...(bySupplier.get(m.supplier_id) || []), { ...i, unit_cost: m.unit_cost }]);
    }
    const pos = [];
    for (const [supplierId, lines] of bySupplier) {
      const { rows: [sup] } = await db.query('SELECT lead_time_days FROM suppliers WHERE id = $1', [supplierId]);
      const { rows: [po] } = await db.query(
        `INSERT INTO purchase_orders (supplier_id, expected_date) VALUES ($1, CURRENT_DATE + $2::int) RETURNING *`,
        [supplierId, sup.lead_time_days]);
      for (const l of lines)
        await db.query('INSERT INTO po_items (po_id, material_id, qty, unit_cost) VALUES ($1,$2,$3,$4)',
          [po.id, l.material_id, l.qty, l.unit_cost]);
      pos.push(po);
    }
    return pos;
  });
  res.status(201).json(created);
});
