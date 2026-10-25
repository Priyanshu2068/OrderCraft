// End-to-end API tests: run against the DATABASE_URL database (migrated + seeded).
// They create real rows, so point DATABASE_URL at a dev database.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

const server = createApp().listen(0);
const base = `http://localhost:${server.address().port}/api`;
after(async () => { server.close(); await pool.end(); });

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}
const loginAs = async (email) =>
  (await call('POST', '/auth/login', { body: { email, password: 'password123' } })).data.token;
const staff = (role) => loginAs(`${role}@ordercraft.test`);

test('order-to-cash with shortage, promise date, margin and audit trail', async () => {
  const [sales, planner, warehouse, finance] = await Promise.all(['sales', 'planner', 'warehouse', 'finance'].map(staff));
  assert.equal((await call('GET', '/orders')).status, 401, 'requires auth');

  const customers = (await call('GET', '/customers', { token: sales })).data;
  const acme = customers.find((c) => c.name === 'Acme Industries');
  const products = (await call('GET', '/products', { token: sales })).data;
  const frame = products.find((p) => p.sku === 'FRM-300');
  const items = [{ product_id: frame.id, qty: 5 }];

  // the aluminium is short (and already claimed by an earlier order) => promise date is pushed out
  const est = await call('POST', '/orders/estimate', { token: sales, body: { items } });
  assert.equal(est.status, 200);
  assert.ok(est.data.blockers.some((b) => b.code === 'MAT-ALU'));
  assert.ok(est.data.days >= 4 + 7, 'frame lead time + supplier lead time');

  const created = await call('POST', '/orders', { token: sales, body: { customer_id: acme.id, items } });
  assert.equal(created.status, 201);
  const id = created.data.id;
  assert.equal(created.data.status, 'quote');
  assert.equal(created.data.discount_pct, 5, 'customer default discount applied');
  assert.equal(created.data.total_amount, 451.25);

  assert.equal((await call('POST', '/orders', { token: finance, body: {} })).status, 403);
  assert.equal((await call('PATCH', `/orders/${id}/status`, { token: sales, body: { status: 'confirmed' } })).status, 200);

  const blocked = await call('POST', `/orders/${id}/work-orders`, { token: planner });
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /shortage/i);
  assert.equal((await call('GET', `/orders/${id}`, { token: sales })).data.status, 'confirmed', 'rolled back');

  const pos = await call('POST', `/purchase-orders/from-order/${id}`, { token: planner });
  assert.equal(pos.status, 201);
  for (const po of pos.data) assert.equal((await call('POST', `/purchase-orders/${po.id}/receive`, { token: warehouse })).status, 200);
  assert.ok((await call('GET', `/orders/${id}/bom`, { token: planner })).data.every((b) => b.shortage === 0));

  const wo = await call('POST', `/orders/${id}/work-orders`, { token: planner });
  assert.equal(wo.status, 201);
  assert.equal((await call('PATCH', `/work-orders/${wo.data.id}`, { token: planner, body: { status: 'done' } })).status, 200);
  assert.equal((await call('PATCH', `/work-orders/${wo.data.id}`, { token: planner, body: { status: 'done' } })).status, 409);

  assert.equal((await call('POST', `/orders/${id}/invoice`, { token: finance })).status, 409, 'not shipped yet');
  assert.equal((await call('POST', `/orders/${id}/shipments`, { token: warehouse, body: { carrier: 'DHL' } })).status, 201);
  const inv = await call('POST', `/orders/${id}/invoice`, { token: finance });
  assert.equal(inv.status, 201);
  assert.equal(inv.data.amount, 451.25);

  const pay = (amount) => call('POST', `/invoices/${inv.data.id}/payments`, { token: finance, body: { amount } });
  assert.equal((await pay(400)).data.status, 'partial');
  assert.equal((await pay(500)).status, 400, 'overpay rejected');
  assert.equal((await pay(51.25)).data.status, 'paid');

  const detail = (await call('GET', `/orders/${id}`, { token: sales })).data;
  assert.equal(detail.status, 'paid');
  assert.deepEqual(detail.events.map((e) => e.status),
    ['quote', 'confirmed', 'in_production', 'ready', 'shipped', 'invoiced', 'paid'], 'full audit trail');
  assert.equal(detail.pricing.cost_is_actual, true);
  assert.ok(detail.pricing.margin > 0 && detail.pricing.margin_pct < 100);

  assert.equal((await call('GET', `/invoices/${inv.data.id}/pdf`, { token: finance })).status, 200);
  const summary = (await call('GET', '/reports/summary', { token: finance })).data;
  assert.ok(summary.revenueByMonth.length > 0 && summary.topProducts.length > 0);
  assert.equal(typeof summary.marginPct, 'number');
});

test('customer portal: isolation, self-service quote, approval, tracking, reorder', async () => {
  const acme = await loginAs('customer@acme.test');
  const sales = await staff('sales');

  // customers cannot touch staff endpoints
  assert.equal((await call('GET', '/orders', { token: acme })).status, 403);
  assert.equal((await call('GET', '/reports/summary', { token: acme })).status, 403);
  // staff are not customers
  assert.equal((await call('GET', '/portal/orders', { token: sales })).status, 403);

  const catalog = (await call('GET', '/portal/catalog', { token: acme })).data;
  const bracket = catalog.find((p) => p.sku === 'BRK-200');
  const items = [{ product_id: bracket.id, qty: 10 }];

  const est = (await call('POST', '/portal/estimate', { token: acme, body: { items } })).data;
  assert.ok(est.date && !('blockers' in est), 'customers see a date, not our stock');

  const req = await call('POST', '/portal/orders', { token: acme, body: { items } });
  assert.equal(req.status, 201);
  const id = req.data.id;

  const mine = (await call('GET', '/portal/orders', { token: acme })).data;
  assert.ok(mine.every((o) => o.id !== undefined) && mine.some((o) => o.id === id));
  const view = (await call('GET', `/portal/orders/${id}`, { token: acme })).data;
  assert.equal(view.status, 'quote');
  assert.ok(!('margin' in view.pricing) && !('promise' in view), 'internal numbers hidden');

  // another customer's order is invisible
  const other = (await call('GET', '/orders?status=paid', { token: sales })).data
    .find((o) => o.customer_name === 'Globex Corp');
  assert.equal((await call('GET', `/portal/orders/${other.id}`, { token: acme })).status, 404);
  assert.equal((await call('POST', `/portal/orders/${other.id}/approve`, { token: acme })).status, 404);

  assert.equal((await call('POST', `/portal/orders/${id}/approve`, { token: acme })).status, 200);
  assert.equal((await call('POST', `/portal/orders/${id}/approve`, { token: acme })).status, 409, 'only once');
  assert.equal((await call('GET', `/portal/orders/${id}`, { token: acme })).data.status, 'confirmed');

  // public tracking link needs no login and exposes no money
  const staffView = (await call('GET', `/orders/${id}`, { token: sales })).data;
  const track = await call('GET', `/track/${staffView.tracking_token}`);
  assert.equal(track.status, 200);
  assert.equal(track.data.order_no, view.order_no);
  assert.ok(!('total_amount' in track.data) && !('id' in track.data));
  assert.equal((await call('GET', '/track/not-a-real-token')).status, 404);

  const again = await call('POST', `/portal/orders/${id}/reorder`, { token: acme });
  assert.equal(again.status, 201);
  assert.equal((await call('GET', `/portal/orders/${again.data.id}`, { token: acme })).data.status, 'quote');
});

test('reports: reorder suggestions, schedule, late risk, csv', async () => {
  const planner = await staff('planner');
  const sug = await call('GET', '/reports/reorder-suggestions', { token: planner });
  assert.equal(sug.status, 200);
  const alu = sug.data.find((m) => m.code === 'MAT-ALU');
  assert.ok(alu && alu.suggested_qty > 0, 'aluminium is below its reorder level');

  const po = await call('POST', '/purchase-orders/from-suggestions', {
    token: planner, body: { items: [{ material_id: alu.id, qty: alu.suggested_qty }] },
  });
  assert.equal(po.status, 201);
  const after = (await call('GET', '/reports/reorder-suggestions', { token: planner })).data;
  const aluAfter = after.find((m) => m.code === 'MAT-ALU');
  assert.ok(!aluAfter || aluAfter.suggested_qty < alu.suggested_qty, 'open PO counts as on-order stock');

  assert.ok((await call('GET', '/reports/schedule', { token: planner })).data.length > 0);
  const summary = (await call('GET', '/reports/summary', { token: planner })).data;
  assert.ok(summary.lateRisk.length > 0, 'seeded confirmed order cannot meet its due date');
  const csv = await call('GET', '/reports/orders.csv', { token: planner });
  assert.match(csv.data, /^order_no,customer,status/);
});
