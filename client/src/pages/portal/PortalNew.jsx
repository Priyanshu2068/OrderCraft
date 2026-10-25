import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useApi } from '../../api.js';
import { date, money } from '../../format.js';
import { useToast } from '../../toast.jsx';

export default function PortalNew() {
  const nav = useNavigate();
  const notify = useToast();
  const catalog = useApi('/portal/catalog').data || [];
  const [qty, setQty] = useState({});
  const [dueDate, setDueDate] = useState('');
  const [estimate, setEstimate] = useState(null);

  const items = Object.entries(qty).filter(([, q]) => Number(q) > 0).map(([id, q]) => ({ product_id: Number(id), qty: Number(q) }));
  const total = items.reduce((s, i) => s + i.qty * (catalog.find((p) => p.id === i.product_id)?.unit_price ?? 0), 0);
  const key = JSON.stringify(items);

  useEffect(() => {
    if (!items.length) { setEstimate(null); return; }
    let live = true;
    api('POST', '/portal/estimate', { items }).then((e) => live && setEstimate(e)).catch(() => {});
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    try {
      const o = await api('POST', '/portal/orders', { items, due_date: dueDate || null });
      notify(`Quote ${o.order_no} created — review and approve it to start production`);
      nav(`/portal/orders/${o.id}`);
    } catch (err) { notify(err.message, 'error'); }
  }

  return (
    <div className="card wide">
      <h1>Request a quote</h1>
      <p className="muted">Pick what you need. We'll tell you the delivery date before you commit.</p>
      {catalog.map((p) => (
        <div className="row" key={p.id}>
          <div className="grow"><b>{p.name}</b> <span className="muted">{p.sku}</span><br /><small className="muted">{money(p.unit_price)} each · about {p.lead_time_days} days to make</small></div>
          <input type="number" min="0" placeholder="Qty" value={qty[p.id] ?? ''} onChange={(e) => setQty({ ...qty, [p.id]: e.target.value })} />
        </div>
      ))}
      <label>Need it by (optional)<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
      {estimate && (
        <div className={`promise ${dueDate && estimate.date > dueDate ? 'late' : ''}`}>
          <b>Estimated delivery: {date(estimate.date)}</b> <span className="muted">({estimate.days} days)</span>
          {dueDate && estimate.date > dueDate && <div className="error">This is later than your requested date — you can still request the quote and talk to us.</div>}
        </div>
      )}
      <p className="totals">Estimated total (before your discount and tax): <b>{money(total)}</b></p>
      <button className="primary" disabled={!items.length} onClick={submit}>Request quote</button>
    </div>
  );
}
