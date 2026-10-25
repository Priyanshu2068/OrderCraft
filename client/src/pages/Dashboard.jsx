import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApi } from '../api.js';
import { useAuth } from '../auth.jsx';
import { CountUp, greeting } from '../fun.jsx';
import { date, money, STAGE_LABEL } from '../format.js';

const ACCENT = '#6d5efc';
const CORAL = '#ff7a59';

function Kpi({ emoji, label, value, format, hint, tone }) {
  return (
    <div className={`card kpi lift ${tone || ''}`}>
      <span className="kpi-emoji">{emoji}</span>
      <span className="muted">{label}</span>
      <strong>{typeof value === 'number' ? <CountUp value={value} format={format} /> : value}</strong>
      {hint && <small className="muted">{hint}</small>}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data, error } = useApi('/reports/summary');
  if (error) return <p className="error">{error}</p>;
  if (!data) return <div className="skeleton-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" />)}</div>;

  const count = (s) => data.ordersByStatus.find((x) => x.status === s)?.count ?? 0;
  const todo = [
    count('quote') && { to: '/orders?status=quote', text: `${count('quote')} quote${count('quote') > 1 ? 's' : ''} waiting to be confirmed`, emoji: '📝' },
    data.lateRisk.length && { to: '/planning', text: `${data.lateRisk.length} order${data.lateRisk.length > 1 ? 's' : ''} will miss the due date`, emoji: '⏰' },
    data.lowStock.length && { to: '/planning', text: `${data.lowStock.length} material${data.lowStock.length > 1 ? 's' : ''} below reorder level`, emoji: '📉' },
    data.overdueInvoices.length && { to: '/invoices', text: `${data.overdueInvoices.length} overdue invoice${data.overdueInvoices.length > 1 ? 's' : ''}`, emoji: '💸' },
  ].filter(Boolean);

  const status = data.ordersByStatus.map((s) => ({ ...s, name: STAGE_LABEL[s.status] }));
  return (
    <div>
      <div className="hero">
        <div>
          <h1>{greeting(user.name)} 👋</h1>
          <p>{todo.length ? `${todo.length} thing${todo.length > 1 ? 's' : ''} could use your attention today.` : 'Everything is on track. Enjoy the calm ☕'}</p>
        </div>
        <Link className="button hero-btn" to="/board">Open order board →</Link>
      </div>

      {todo.length > 0 && (
        <div className="chips">
          {todo.map((t) => <Link key={t.text} to={t.to} className="chip">{t.emoji} {t.text}</Link>)}
        </div>
      )}

      <div className="grid">
        <Kpi emoji="💰" label="Revenue collected" value={data.revenue} format={(n) => money(n)} />
        <Kpi emoji="🚀" label="Open pipeline" value={data.pipeline.value} format={(n) => money(n)} hint={`${data.pipeline.count} orders in flight`} />
        <Kpi emoji="🧾" label="Receivables" value={data.receivables} format={(n) => money(n)} hint={`${data.overdueInvoices.length} overdue`} tone={data.overdueInvoices.length ? 'warn' : ''} />
        <Kpi emoji="⏱️" label="On-time delivery" value={data.onTimePct ?? '—'} format={(n) => `${Math.round(n)}%`} hint="shipped by promised/due date" />
        <Kpi emoji="📈" label="Gross margin" value={data.marginPct ?? '—'} format={(n) => `${n.toFixed(1)}%`} hint="actual material cost" />
      </div>

      {data.lateRisk.length > 0 && (
        <div className="card alert">
          <h3>⚠️ At risk of missing the due date</h3>
          <ul className="plain">
            {data.lateRisk.map((o) => (
              <li key={o.id}><Link to={`/orders/${o.id}`}><b>{o.order_no}</b></Link> · {o.customer_name} — wanted {date(o.due_date)}, we can deliver {date(o.promised_date)}</li>
            ))}
          </ul>
          <Link to="/planning">Fix it with reorder suggestions →</Link>
        </div>
      )}

      <div className="grid two">
        <div className="card">
          <h3>Revenue collected by month</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.revenueByMonth}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" /><YAxis /><Tooltip formatter={(v) => money(v)} />
              <Bar dataKey="revenue" fill={ACCENT} radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <h3>Orders by status</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={status} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="name" width={100} /><Tooltip />
              <Bar dataKey="count" fill={CORAL} radius={[0, 8, 8, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <h3>Top products by revenue</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.topProducts}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" /><YAxis /><Tooltip formatter={(v) => money(v)} />
              <Bar dataKey="revenue" fill={ACCENT} radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <h3>Low stock</h3>
          {data.lowStock.length === 0 && <p className="muted">All materials above reorder level 🎉</p>}
          <ul className="plain">
            {data.lowStock.map((m) => (
              <li key={m.id}><b>{m.code}</b> {m.name}: {m.stock_qty} <span className="muted">(reorder at {m.reorder_level})</span></li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
