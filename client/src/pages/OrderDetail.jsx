import { Link, useParams } from 'react-router-dom';
import { api, useApi } from '../api.js';
import { useAuth } from '../auth.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { Stepper, Timeline } from '../components/Timeline.jsx';
import { date, money } from '../format.js';
import { useToast } from '../toast.jsx';
import { celebrate } from '../fun.jsx';

export default function OrderDetail() {
  const { id } = useParams();
  const { data: order, error, reload } = useApi(`/orders/${id}`);
  const bom = useApi(`/orders/${id}/bom`);
  const { can } = useAuth();
  const notify = useToast();

  if (error) return <p className="error">{error}</p>;
  if (!order) return <p className="muted">Loading…</p>;

  const run = (fn, ok, party) => async () => {
    try { await fn(); if (ok) notify(ok); if (party) celebrate(); await Promise.all([reload(), bom.reload()]); } catch (err) { notify(err.message, 'error'); }
  };
  const hasShortage = (bom.data || []).some((b) => b.shortage > 0);
  const woRunning = order.work_orders.find((w) => w.status !== 'done');
  const p = order.pricing;
  const trackUrl = `${window.location.origin}/track/${order.tracking_token}`;
  const preProd = ['quote', 'draft', 'confirmed'].includes(order.status);
  const late = order.due_date && order.promised_date > order.due_date && preProd;

  return (
    <div>
      <div className="row between">
        <h1>{order.order_no} <StatusBadge status={order.status} /></h1>
        <Link to="/orders">← Orders</Link>
      </div>
      <p>Customer: <b>{order.customer_name}</b> · Created {date(order.created_at)}</p>
      <Stepper status={order.status} />

      <div className="row wrap actions-bar">
        {['quote', 'draft'].includes(order.status) && can('sales', 'planner') && (
          <button className="primary" onClick={run(() => api('PATCH', `/orders/${id}/status`, { status: 'confirmed' }), 'Order confirmed')}>Confirm order</button>
        )}
        {['quote', 'draft', 'confirmed'].includes(order.status) && can('sales', 'planner') && (
          <button className="danger" onClick={run(() => api('PATCH', `/orders/${id}/status`, { status: 'cancelled' }), 'Order cancelled')}>Cancel</button>
        )}
        {order.status === 'confirmed' && hasShortage && can('planner', 'warehouse') && (
          <button onClick={run(() => api('POST', `/purchase-orders/from-order/${id}`), 'Purchase orders raised')}>Raise purchase orders for shortages</button>
        )}
        {order.status === 'confirmed' && can('planner') && (
          <button className="primary" disabled={hasShortage} onClick={run(() => api('POST', `/orders/${id}/work-orders`), 'Production started')}>Start production</button>
        )}
        {order.status === 'in_production' && woRunning && can('planner', 'warehouse') && (
          <button className="primary" onClick={run(() => api('PATCH', `/work-orders/${woRunning.id}`, { status: 'done' }), 'Production completed — materials consumed 🎉', true)}>Complete production</button>
        )}
        {order.status === 'ready' && can('warehouse') && (
          <button className="primary" onClick={run(() => {
            const carrier = window.prompt('Carrier?');
            if (!carrier) return Promise.resolve();
            return api('POST', `/orders/${id}/shipments`, { carrier, tracking_no: window.prompt('Tracking number (optional)') || undefined });
          }, 'Order shipped 🚚', true)}>Ship order</button>
        )}
        {order.status === 'shipped' && can('finance') && (
          <button className="primary" onClick={run(() => api('POST', `/orders/${id}/invoice`), 'Invoice created')}>Create invoice</button>
        )}
        {order.invoice && <Link className="button" to="/invoices">Invoice {order.invoice.invoice_no} →</Link>}
        <button onClick={() => { navigator.clipboard?.writeText(trackUrl); notify('Customer tracking link copied'); }}>🔗 Copy tracking link</button>
      </div>

      <div className="grid two">
        <div className="card">
          <h3>Delivery</h3>
          <p>Customer wants: <b>{date(order.due_date)}</b></p>
          <p>We promise: <b className={late ? 'error' : ''}>{date(order.promised_date)}</b>{late && ' ⚠ later than requested'}</p>
          {order.promise && (
            <>
              <p className="muted">Live estimate today: {date(order.promise.date)} ({order.promise.production_days}d production
                {order.promise.material_wait_days > 0 && ` + ${order.promise.material_wait_days}d waiting for materials`})</p>
              {order.promise.blockers.map((b) => <p key={b.code} className="error">{b.code} short by {b.shortage} {b.uom} (restock {b.wait_days}d)</p>)}
            </>
          )}
        </div>
        <div className="card">
          <h3>Pricing &amp; margin</h3>
          <table className="plain-table">
            <tbody>
              <tr><td>Subtotal</td><td className="num">{money(p.subtotal)}</td></tr>
              <tr><td>Discount ({order.discount_pct}%)</td><td className="num">−{money(p.discount)}</td></tr>
              <tr><td>Tax ({order.tax_pct}%)</td><td className="num">{money(p.tax)}</td></tr>
              <tr><td><b>Total</b></td><td className="num"><b>{money(p.total)}</b></td></tr>
              <tr className="muted"><td>Material cost {p.cost_is_actual ? '(actual)' : '(estimated)'}</td><td className="num">{money(p.material_cost)}</td></tr>
              <tr><td>Margin</td><td className="num"><b className={p.margin < 0 ? 'error' : 'good'}>{money(p.margin)} ({p.margin_pct}%)</b></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <h3>Items</h3>
          <table>
            <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Total</th></tr></thead>
            <tbody>
              {order.items.map((i) => (
                <tr key={i.id}><td>{i.sku} {i.name}</td><td className="num">{i.qty}</td>
                  <td className="num">{money(i.unit_price)}</td><td className="num">{money(i.qty * i.unit_price)}</td></tr>
              ))}
            </tbody>
          </table>
          <h3>Materials</h3>
          <table>
            <thead><tr><th>Material</th><th className="num">Required</th><th className="num">Free stock</th><th className="num">Short</th></tr></thead>
            <tbody>
              {(bom.data || []).map((b) => (
                <tr key={b.material_id} className={b.shortage > 0 ? 'short' : ''}>
                  <td>{b.code}</td><td className="num">{b.required} {b.uom}</td>
                  <td className="num">{b.available}</td><td className="num">{b.shortage || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">Free stock = on hand minus what earlier confirmed orders have claimed (first come, first served). After production, consumed materials are no longer counted.</p>
        </div>
        <div className="card">
          <h3>History</h3>
          <Timeline events={order.events} />
          {order.shipments.map((s) => <p key={s.id} className="muted">📦 {date(s.shipped_at)} — {s.carrier} {s.tracking_no}</p>)}
        </div>
      </div>
    </div>
  );
}
