import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi } from '../api.js';
import { celebrate } from '../fun.jsx';
import { date, money, STAGE_LABEL } from '../format.js';
import { STAGE_EMOJI } from '../components/StatusBadge.jsx';
import { useToast } from '../toast.jsx';

const COLUMNS = ['quote', 'confirmed', 'in_production', 'ready', 'shipped', 'invoiced', 'paid'];
const HINT = {
  quote: 'Drop here to confirm', confirmed: 'Starts production', in_production: 'Completes production',
  ready: 'Ship it', shipped: 'Creates the invoice', invoiced: 'Record payment on Invoices', paid: '',
};

export default function Board() {
  const { data, error, reload } = useApi('/orders');
  const notify = useToast();
  const [drag, setDrag] = useState(null); // order being dragged
  const [over, setOver] = useState(null);

  const orders = (data || []).filter((o) => o.status !== 'cancelled');
  const next = (s) => COLUMNS[COLUMNS.indexOf(s) + 1];

  async function move(order, to) {
    const from = order.status === 'draft' ? 'quote' : order.status;
    if (to === from) return;
    if (to !== next(from)) return notify(`${order.order_no} can only move forward one step → ${STAGE_LABEL[next(from)] ?? 'nowhere'}`, 'error');
    const id = order.id;
    try {
      if (from === 'quote') await api('PATCH', `/orders/${id}/status`, { status: 'confirmed' });
      else if (from === 'confirmed') await api('POST', `/orders/${id}/work-orders`);
      else if (from === 'in_production') {
        const d = await api('GET', `/orders/${id}`);
        await api('PATCH', `/work-orders/${d.work_orders.find((w) => w.status !== 'done').id}`, { status: 'done' });
      } else if (from === 'ready') {
        const carrier = window.prompt('Which carrier is shipping it?', 'DHL');
        if (!carrier) return;
        await api('POST', `/orders/${id}/shipments`, { carrier });
      } else if (from === 'shipped') await api('POST', `/orders/${id}/invoice`);
      else if (from === 'invoiced') return notify('Record the payment on the Invoices page to mark it paid 💰');
      if (['ready', 'shipped'].includes(to)) celebrate();
      notify(`${order.order_no} → ${STAGE_LABEL[to]} ${STAGE_EMOJI[to]}`);
      reload();
    } catch (err) {
      notify(err.status === 403 ? `Your role can't move orders to “${STAGE_LABEL[to]}”` : err.message, 'error');
    }
  }

  return (
    <div>
      <div className="row between">
        <div>
          <h1>Order board</h1>
          <p className="muted">Drag a card one column to the right to move it forward. The server checks stock, roles and rules for you.</p>
        </div>
        <Link className="button" to="/orders">List view</Link>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="board">
        {COLUMNS.map((col) => {
          const cards = orders.filter((o) => (o.status === 'draft' ? 'quote' : o.status) === col);
          const shown = col === 'paid' ? cards.slice(0, 6) : cards;
          const valid = drag && next(drag.status === 'draft' ? 'quote' : drag.status) === col;
          return (
            <div key={col} className={`column ${valid ? 'valid' : ''} ${over === col && valid ? 'hot' : ''} ${drag && !valid ? 'dim' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(col); }} onDragLeave={() => setOver(null)}
              onDrop={() => { const o = drag; setDrag(null); setOver(null); if (o) move(o, col); }}>
              <div className="column-head">
                <span>{STAGE_EMOJI[col]} {STAGE_LABEL[col]}</span><span className="count">{cards.length}</span>
              </div>
              {valid && <div className="drop-hint">{HINT[drag.status === 'draft' ? 'quote' : drag.status]}</div>}
              {shown.map((o) => (
                <div key={o.id} className={`order-card ${o.late_risk ? 'late' : ''} ${drag?.id === o.id ? 'dragging' : ''}`}
                  draggable onDragStart={() => setDrag(o)} onDragEnd={() => { setDrag(null); setOver(null); }}>
                  <Link to={`/orders/${o.id}`}><b>{o.order_no}</b></Link>
                  <div>{o.customer_name}</div>
                  <div className="row between">
                    <span className="muted">{date(o.promised_date)}{o.late_risk ? ' ⚠️' : ''}</span>
                    <b>{money(o.total_amount)}</b>
                  </div>
                </div>
              ))}
              {!shown.length && <div className="column-empty">Nothing here</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
