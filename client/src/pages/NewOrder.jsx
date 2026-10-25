import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useApi } from '../api.js';
import { date, money } from '../format.js';
import { useToast } from '../toast.jsx';

export default function NewOrder() {
  const nav = useNavigate();
  const notify = useToast();
  const customers = useApi('/customers').data || [];
  const products = useApi('/products').data || [];
  const [customerId, setCustomerId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [discount, setDiscount] = useState('');
  const [tax, setTax] = useState('0');
  const [lines, setLines] = useState([{ product_id: '', qty: 1 }]);
  const [promise, setPromise] = useState(null);

  const customer = customers.find((c) => c.id === Number(customerId));
  const effectiveDiscount = discount === '' ? customer?.discount_pct ?? 0 : Number(discount);
  const price = (id) => products.find((p) => p.id === Number(id))?.unit_price ?? 0;
  const subtotal = lines.reduce((s, l) => s + price(l.product_id) * Number(l.qty || 0), 0);
  const net = subtotal * (1 - effectiveDiscount / 100);
  const total = net * (1 + Number(tax || 0) / 100);
  const setLine = (i, patch) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const valid = lines.filter((l) => l.product_id && Number(l.qty) > 0).map((l) => ({ product_id: Number(l.product_id), qty: Number(l.qty) }));
  const key = JSON.stringify(valid);
  useEffect(() => {
    if (!valid.length) { setPromise(null); return; }
    let live = true;
    api('POST', '/orders/estimate', { items: valid }).then((p) => live && setPromise(p)).catch(() => {});
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault();
    try {
      const order = await api('POST', '/orders', {
        customer_id: Number(customerId), due_date: dueDate || null, items: valid,
        ...(discount !== '' && { discount_pct: Number(discount) }), tax_pct: Number(tax || 0),
      });
      notify(`Quote ${order.order_no} created`);
      nav(`/orders/${order.id}`);
    } catch (err) { notify(err.message, 'error'); }
  }

  const late = promise && dueDate && promise.date > dueDate;
  return (
    <form onSubmit={submit} className="card wide">
      <h1>New quote</h1>
      <label>Customer
        <select required value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">Select…</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.discount_pct > 0 ? ` (${c.discount_pct}% discount)` : ''}</option>)}
        </select>
      </label>
      <div className="row">
        <label className="grow">Customer needs it by<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
        <label className="grow">Discount % <input type="number" min="0" max="100" step="any" placeholder={String(customer?.discount_pct ?? 0)} value={discount} onChange={(e) => setDiscount(e.target.value)} /></label>
        <label className="grow">Tax % <input type="number" min="0" max="100" step="any" value={tax} onChange={(e) => setTax(e.target.value)} /></label>
      </div>
      <h3>Items</h3>
      {lines.map((l, i) => (
        <div className="row" key={i}>
          <select className="grow" required value={l.product_id} onChange={(e) => setLine(i, { product_id: e.target.value })}>
            <option value="">Product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name} ({money(p.unit_price)})</option>)}
          </select>
          <input type="number" min="1" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
          <span className="num w100">{money(price(l.product_id) * Number(l.qty || 0))}</span>
          {lines.length > 1 && <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button>}
        </div>
      ))}
      <button type="button" onClick={() => setLines([...lines, { product_id: '', qty: 1 }])}>+ Add line</button>

      {promise && (
        <div className={`promise ${late ? 'late' : ''}`}>
          <b>We can deliver by {date(promise.date)}</b> <span className="muted">({promise.days} days)</span>
          {late && <div className="error">That's after the customer's date. Consider restocking or negotiating.</div>}
          {promise.blockers.length > 0 && (
            <ul>{promise.blockers.map((b) => <li key={b.code}>{b.code}: short by {b.shortage} {b.uom} — {b.wait_days} days to restock</li>)}</ul>
          )}
        </div>
      )}

      <p className="totals">
        Subtotal {money(subtotal)} · Discount {effectiveDiscount}% · Tax {tax || 0}% · <b>Total {money(total)}</b>
      </p>
      <button className="primary" type="submit">Create quote</button>
    </form>
  );
}
