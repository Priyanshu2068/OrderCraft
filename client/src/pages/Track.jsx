import { useParams } from 'react-router-dom';
import { useApi } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import { Stepper, Timeline } from '../components/Timeline.jsx';
import { date } from '../format.js';

// Public page: anyone with the link can follow the order, no login, no prices.
export default function Track() {
  const { token } = useParams();
  const { data: o, error } = useApi(`/track/${token}`);
  return (
    <div className="track">
      <h2>OrderCraft</h2>
      {error && <div className="card"><p className="error">{error}</p></div>}
      {!o && !error && <p className="muted">Loading…</p>}
      {o && (
        <div className="card">
          <h1>{o.order_no} <StatusBadge status={o.status} /></h1>
          <p className="muted">for {o.customer_name}</p>
          <Stepper status={o.status} />
          <p>Expected delivery: <b>{date(o.promised_date)}</b></p>
          {o.shipments.map((s, i) => <p key={i}>📦 Shipped {date(s.shipped_at)} via {s.carrier} {s.tracking_no && <b>({s.tracking_no})</b>}</p>)}
          <h3>Items</h3>
          <ul className="plain">{o.items.map((i, k) => <li key={k}>{i.qty} × {i.name}</li>)}</ul>
          <h3>Progress</h3>
          <Timeline events={o.events} />
        </div>
      )}
    </div>
  );
}
