import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, useApi } from '../../api.js';
import StatusBadge from '../../components/StatusBadge.jsx';
import { Stepper, Timeline } from '../../components/Timeline.jsx';
import { date, money } from '../../format.js';
import { useToast } from '../../toast.jsx';
import { celebrate } from '../../fun.jsx';
import { openInvoicePdf } from './PortalHome.jsx';

export default function PortalOrder() {
  const { id } = useParams();
  const nav = useNavigate();
  const notify = useToast();
  const { data: o, error, reload } = useApi(`/portal/orders/${id}`);
  const invoices = useApi('/portal/invoices');

  if (error) return <p className="error">{error}</p>;
  if (!o) return <p className="muted">Loading…</p>;
  const invoice = (invoices.data || []).find((i) => i.order_no === o.order_no);

  const act = (fn, ok, party) => async () => {
    try { const r = await fn(); notify(ok); if (party) celebrate(true); if (r?.id) nav(`/portal/orders/${r.id}`); else reload(); } catch (err) { notify(err.message, 'error'); }
  };
  const trackUrl = `${window.location.origin}/track/${o.tracking_token}`;

  return (
    <div>
      <div className="row between">
        <h1>{o.order_no} <StatusBadge status={o.status} /></h1>
        <Link to="/portal">← All orders</Link>
      </div>
      <Stepper status={o.status} />

      {o.status === 'quote' && (
        <div className="card alert-info">
          <h3>Your quote is ready</h3>
          <p>Estimated delivery <b>{date(o.promised_date)}</b>. Approve it to start production.</p>
          <div className="row">
            <button className="primary" onClick={act(() => api('POST', `/portal/orders/${id}/approve`), 'Quote approved — we are on it! 🎉', true)}>Approve quote</button>
            <button className="danger" onClick={act(() => api('POST', `/portal/orders/${id}/cancel`), 'Quote cancelled')}>Decline</button>
          </div>
        </div>
      )}

      <div className="grid two">
        <div className="card">
          <h3>Delivery</h3>
          <p>Expected: <b>{date(o.promised_date)}</b></p>
          {o.due_date && <p className="muted">You asked for {date(o.due_date)}</p>}
          {o.shipments.map((s) => <p key={s.id}>📦 Shipped {date(s.shipped_at)} via {s.carrier} {s.tracking_no && <b>({s.tracking_no})</b>}</p>)}
          <p className="muted">Share live status without a login: <a href={trackUrl}>tracking link</a></p>
          <h3>Order</h3>
          <table>
            <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Total</th></tr></thead>
            <tbody>
              {o.items.map((i) => <tr key={i.id}><td>{i.name}</td><td className="num">{i.qty}</td><td className="num">{money(i.unit_price)}</td><td className="num">{money(i.qty * i.unit_price)}</td></tr>)}
            </tbody>
          </table>
          <table className="plain-table">
            <tbody>
              <tr><td>Subtotal</td><td className="num">{money(o.pricing.subtotal)}</td></tr>
              {o.discount_pct > 0 && <tr><td>Your discount ({o.discount_pct}%)</td><td className="num">−{money(o.pricing.discount)}</td></tr>}
              {o.tax_pct > 0 && <tr><td>Tax ({o.tax_pct}%)</td><td className="num">{money(o.pricing.tax)}</td></tr>}
              <tr><td><b>Total</b></td><td className="num"><b>{money(o.pricing.total)}</b></td></tr>
            </tbody>
          </table>
          <div className="row">
            <button onClick={act(() => api('POST', `/portal/orders/${id}/reorder`), 'Reorder created as a new quote')}>↻ Reorder these items</button>
            {invoice && <button onClick={() => openInvoicePdf(invoice.id)}>Download invoice {invoice.invoice_no}</button>}
          </div>
        </div>
        <div className="card">
          <h3>Progress</h3>
          <Timeline events={o.events} />
        </div>
      </div>
    </div>
  );
}
