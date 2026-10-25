import bcrypt from 'bcryptjs';
import { pool } from './pool.js';

const hash = bcrypt.hashSync('password123', 10);
const users = [
  ['Admin', 'admin@ordercraft.test', 'admin'],
  ['Sam Sales', 'sales@ordercraft.test', 'sales'],
  ['Pat Planner', 'planner@ordercraft.test', 'planner'],
  ['Wendy Warehouse', 'warehouse@ordercraft.test', 'warehouse'],
  ['Fin Finance', 'finance@ordercraft.test', 'finance'],
];
for (const [name, email, role] of users) {
  await pool.query(
    `INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING`,
    [name, email, hash, role]);
}

const { rows: [{ count }] } = await pool.query('SELECT count(*)::int AS count FROM products');
if (count === 0) {
  const sup = async (name, email, lead) =>
    (await pool.query('INSERT INTO suppliers (name,email,lead_time_days) VALUES ($1,$2,$3) RETURNING id',
      [name, email, lead])).rows[0].id;
  const s1 = await sup('SteelWorks Ltd', 'sales@steelworks.test', 7);
  const s2 = await sup('FastenerHub', 'sales@fastenerhub.test', 3);
  const s3 = await sup('PaintPro', 'sales@paintpro.test', 5);

  const mat = async (code, name, uom, stock, reorder, cost, sid) =>
    (await pool.query(
      `INSERT INTO materials (code,name,uom,stock_qty,reorder_level,unit_cost,supplier_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [code, name, uom, stock, reorder, cost, sid])).rows[0].id;
  const steel = await mat('MAT-STEEL', 'Steel sheet 2mm', 'kg', 500, 100, 2.5, s1);
  const bolt = await mat('MAT-BOLT', 'M8 bolt', 'pcs', 1000, 200, 0.1, s2);
  const paint = await mat('MAT-PAINT', 'Powder coat paint', 'kg', 40, 10, 8, s3);
  const alum = await mat('MAT-ALU', 'Aluminium bar', 'kg', 20, 50, 4, s1);

  const prod = async (sku, name, price, lead, bom) => {
    const id = (await pool.query(
      'INSERT INTO products (sku,name,unit_price,lead_time_days) VALUES ($1,$2,$3,$4) RETURNING id',
      [sku, name, price, lead])).rows[0].id;
    for (const [m, q] of bom)
      await pool.query('INSERT INTO bom_items (product_id,material_id,qty_per_unit) VALUES ($1,$2,$3)', [id, m, q]);
  };
  await prod('CAB-100', 'Steel Cabinet', 180, 5, [[steel, 12], [bolt, 24], [paint, 0.5]]);
  await prod('BRK-200', 'Mounting Bracket', 15, 2, [[steel, 0.8], [bolt, 4]]);
  await prod('FRM-300', 'Aluminium Frame', 95, 4, [[alum, 6], [bolt, 12], [paint, 0.3]]);

  await pool.query(
    `INSERT INTO customers (name,email,phone,billing_address,shipping_address) VALUES
     ('Acme Industries','buyer@acme.test','555-0100','1 Acme Way','1 Acme Way'),
     ('Globex Corp','orders@globex.test','555-0200','42 Globex Rd','42 Globex Rd')`);
}

// ---- customer portal login + demo history so charts and reports have something to show ----
await pool.query(`UPDATE customers SET discount_pct = 5 WHERE name = 'Acme Industries' AND discount_pct = 0`);
const { rows: [acme] } = await pool.query(`SELECT id FROM customers WHERE name = 'Acme Industries'`);
if (acme) {
  await pool.query(
    `INSERT INTO users (name,email,password_hash,role,customer_id)
     VALUES ('Acme Industries','customer@acme.test',$1,'customer',$2) ON CONFLICT (email) DO NOTHING`,
    [hash, acme.id]);
}

const { rows: [{ n: orderCount }] } = await pool.query('SELECT count(*)::int AS n FROM orders');
if (orderCount === 0) {
  const prods = (await pool.query('SELECT id, unit_price FROM products ORDER BY id')).rows;
  const custs = (await pool.query('SELECT id, discount_pct FROM customers ORDER BY id')).rows;
  const { rows: [sales] } = await pool.query(`SELECT id FROM users WHERE role = 'sales'`);

  async function demo({ cust, status, daysAgo, items, dueIn, promisedIn, paidDaysAgo }) {
    const c = custs[cust];
    const lines = items.map(([p, qty]) => ({ product_id: prods[p].id, qty, price: prods[p].unit_price }));
    const subtotal = lines.reduce((t, l) => t + l.qty * l.price, 0);
    const total = +(subtotal * (1 - c.discount_pct / 100)).toFixed(2);
    const { rows: [o] } = await pool.query(
      `INSERT INTO orders (customer_id, created_by, status, due_date, promised_date, subtotal, discount_pct, total_amount, created_at)
       VALUES ($1,$2,$3, CURRENT_DATE + $4::int, CURRENT_DATE + $5::int, $6,$7,$8, now() - ($9::int || ' days')::interval)
       RETURNING id`,
      [c.id, sales.id, status, dueIn, promisedIn, subtotal, c.discount_pct, total, daysAgo]);
    for (const l of lines)
      await pool.query('INSERT INTO order_items (order_id, product_id, qty, unit_price) VALUES ($1,$2,$3,$4)',
        [o.id, l.product_id, l.qty, l.price]);

    const event = (st, note, days) => pool.query(
      `INSERT INTO order_events (order_id, status, note, created_at) VALUES ($1,$2,$3, now() - ($4::int || ' days')::interval)`,
      [o.id, st, note, days]);
    await event('quote', 'Quote created', daysAgo);
    if (status === 'quote') return;
    await event('confirmed', null, daysAgo - 1);
    if (status === 'confirmed') return;
    await event('in_production', null, daysAgo - 2);
    if (['ready', 'shipped', 'invoiced', 'paid'].includes(status)) {
      for (const l of lines) {
        const { rows: bom } = await pool.query('SELECT material_id, qty_per_unit FROM bom_items WHERE product_id = $1', [l.product_id]);
        for (const b of bom)
          await pool.query(
            `INSERT INTO stock_movements (material_id, qty_change, reason, ref_id, created_at)
             VALUES ($1,$2,'consumption',$3, now() - ($4::int || ' days')::interval)`,
            [b.material_id, -(l.qty * b.qty_per_unit), o.id, daysAgo - 3]);
      }
      await event('ready', 'Production completed', daysAgo - 3);
    }
    if (['shipped', 'invoiced', 'paid'].includes(status)) {
      await pool.query(`INSERT INTO shipments (order_id, carrier, shipped_at) VALUES ($1,'DHL', CURRENT_DATE - $2::int)`, [o.id, daysAgo - 6]);
      await event('shipped', 'Shipped via DHL', daysAgo - 6);
    }
    if (['invoiced', 'paid'].includes(status)) {
      const { rows: [inv] } = await pool.query(
        `INSERT INTO invoices (order_id, amount, due_date, status) VALUES ($1,$2, CURRENT_DATE - $3::int + 30, $4) RETURNING id`,
        [o.id, total, daysAgo - 7, status === 'paid' ? 'paid' : 'unpaid']);
      await event('invoiced', null, daysAgo - 7);
      if (status === 'paid') {
        await pool.query('INSERT INTO payments (invoice_id, amount, method, paid_at) VALUES ($1,$2,$3, CURRENT_DATE - $4::int)',
          [inv.id, total, 'bank transfer', paidDaysAgo]);
        await event('paid', 'Invoice fully paid', paidDaysAgo);
      }
    }
  }
  // paid history across the last months
  await demo({ cust: 0, status: 'paid', daysAgo: 160, items: [[0, 4], [1, 20]], dueIn: -140, promisedIn: -145, paidDaysAgo: 140 });
  await demo({ cust: 1, status: 'paid', daysAgo: 130, items: [[2, 6]], dueIn: -110, promisedIn: -112, paidDaysAgo: 105 });
  await demo({ cust: 0, status: 'paid', daysAgo: 100, items: [[0, 6], [2, 3]], dueIn: -80, promisedIn: -78, paidDaysAgo: 70 });
  await demo({ cust: 1, status: 'paid', daysAgo: 70, items: [[1, 40]], dueIn: -55, promisedIn: -56, paidDaysAgo: 40 });
  await demo({ cust: 0, status: 'paid', daysAgo: 45, items: [[0, 5], [1, 10]], dueIn: -30, promisedIn: -32, paidDaysAgo: 12 });
  await demo({ cust: 1, status: 'invoiced', daysAgo: 40, items: [[2, 4]], dueIn: -20, promisedIn: -22 });
  // live pipeline
  await demo({ cust: 0, status: 'shipped', daysAgo: 12, items: [[0, 3]], dueIn: 3, promisedIn: 2 });
  await demo({ cust: 1, status: 'in_production', daysAgo: 5, items: [[1, 25]], dueIn: 6, promisedIn: 5 });
  await demo({ cust: 0, status: 'confirmed', daysAgo: 2, items: [[2, 5]], dueIn: 4, promisedIn: 16 }); // late risk: aluminium is short
  await demo({ cust: 1, status: 'quote', daysAgo: 1, items: [[0, 2]], dueIn: 14, promisedIn: 5 });
}

console.log('Seeded. Staff: admin@ordercraft.test | customer portal: customer@acme.test (password: password123)');
await pool.end();
