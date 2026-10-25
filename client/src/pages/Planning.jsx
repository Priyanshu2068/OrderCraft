import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getToken, useApi } from '../api.js';
import { useAuth } from '../auth.jsx';
import DataTable from '../components/DataTable.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { daysBetween, date, money } from '../format.js';
import { useToast } from '../toast.jsx';

// Simple Gantt: bar from order creation to promised date, with a marker for the customer's due date.
function Schedule({ rows }) {
  if (!rows.length) return <p className="muted">No orders in the pipeline.</p>;
  const today = new Date().toISOString().slice(0, 10);
  const starts = rows.map((r) => r.start_date);
  const ends = rows.map((r) => r.promised_date || r.due_date || today).concat(rows.map((r) => r.due_date || today));
  const min = starts.concat(today).sort()[0];
  const max = ends.concat(today).sort().at(-1);
  const span = Math.max(1, daysBetween(min, max));
  const pct = (d) => `${(daysBetween(min, d) / span) * 100}%`;
  return (
    <div className="gantt">
      {rows.map((r) => {
        const end = r.promised_date || r.due_date || today;
        return (
          <div className="gantt-row" key={r.id}>
            <Link to={`/orders/${r.id}`} className="gantt-label">{r.order_no}<small className="muted"> {r.customer_name}</small></Link>
            <div className="gantt-track">
              <div className={`gantt-bar ${r.late_risk ? 'late' : ''}`} style={{ left: pct(r.start_date), width: `calc(${pct(end)} - ${pct(r.start_date)})` }} title={`${date(r.start_date)} → ${date(end)}`} />
              {r.due_date && <div className="gantt-due" style={{ left: pct(r.due_date) }} title={`Customer due ${date(r.due_date)}`} />}
              <div className="gantt-today" style={{ left: pct(today) }} />
            </div>
          </div>
        );
      })}
      <p className="muted">Bar = created → our promise date · ◆ = customer due date · red = we can't make it on time · line = today</p>
    </div>
  );
}

export default function Planning() {
  const sug = useApi('/reports/reorder-suggestions');
  const schedule = useApi('/reports/schedule');
  const { can } = useAuth();
  const notify = useToast();
  const [selected, setSelected] = useState({});

  const rows = sug.data || [];
  const chosen = rows.filter((r) => selected[r.id] ?? true);

  async function createPOs() {
    try {
      const pos = await api('POST', '/purchase-orders/from-suggestions', {
        items: chosen.map((r) => ({ material_id: r.id, qty: r.suggested_qty })),
      });
      notify(`Created ${pos.length} purchase order${pos.length > 1 ? 's' : ''}`);
      sug.reload();
    } catch (err) { notify(err.message, 'error'); }
  }

  async function exportCsv() {
    const res = await fetch('/api/reports/orders.csv', { headers: { Authorization: `Bearer ${getToken()}` } });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = 'orders.csv';
    a.click();
  }

  return (
    <div>
      <div className="row between">
        <h1>Planning</h1>
        <button onClick={exportCsv}>⬇ Export orders (CSV)</button>
      </div>

      <div className="card">
        <h3>Production schedule</h3>
        <Schedule rows={schedule.data || []} />
      </div>

      <div className="card">
        <div className="row between">
          <div>
            <h3>Reorder suggestions</h3>
            <p className="muted">Projected stock = on hand − committed to open orders + already on order. Suggests topping up to 2× the reorder level.</p>
          </div>
          {can('planner', 'warehouse') && chosen.length > 0 && (
            <button className="primary" onClick={createPOs}>Create purchase orders ({chosen.length})</button>
          )}
        </div>
        <DataTable searchable={false} empty="All materials are covered 🎉" rows={rows} columns={[
          ...(can('planner', 'warehouse') ? [{ key: 'pick', label: '', sort: false, render: (r) => (
            <input type="checkbox" checked={selected[r.id] ?? true} onChange={(e) => setSelected({ ...selected, [r.id]: e.target.checked })} />) }] : []),
          { key: 'code', label: 'Material', render: (r) => `${r.code} — ${r.name}` },
          { key: 'stock_qty', label: 'On hand', num: true },
          { key: 'committed', label: 'Committed', num: true },
          { key: 'on_order', label: 'On order', num: true },
          { key: 'projected', label: 'Projected', num: true },
          { key: 'suggested_qty', label: 'Suggest', num: true, render: (r) => <b>{r.suggested_qty} {r.uom}</b> },
          { key: 'supplier_name', label: 'Supplier', render: (r) => r.supplier_name ? `${r.supplier_name} (${r.lead_time_days}d)` : <span className="error">none</span> },
          { key: 'est_cost', label: 'Est. cost', num: true, render: (r) => money(r.est_cost) },
        ]} />
      </div>

      <div className="card">
        <h3>Pipeline</h3>
        <DataTable searchable={false} rows={schedule.data || []} columns={[
          { key: 'order_no', label: 'Order', render: (r) => <Link to={`/orders/${r.id}`}>{r.order_no}</Link> },
          { key: 'customer_name', label: 'Customer' },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'due_date', label: 'Customer wants', render: (r) => date(r.due_date) },
          { key: 'promised_date', label: 'We can deliver', render: (r) => <span className={r.late_risk ? 'error' : ''}>{date(r.promised_date)}{r.late_risk ? ' ⚠' : ''}</span> },
        ]} />
      </div>
    </div>
  );
}
