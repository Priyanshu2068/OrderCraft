import { Link } from 'react-router-dom';
import { getToken, useApi } from '../../api.js';
import DataTable from '../../components/DataTable.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { date, money } from '../../format.js';
import { useAuth } from '../../auth.jsx';
import { CountUp, Empty, greeting } from '../../fun.jsx';

export async function openInvoicePdf(id) {
  const res = await fetch(`/api/portal/invoices/${id}/pdf`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) return;
  window.open(URL.createObjectURL(await res.blob()), '_blank');
}

export default function PortalHome() {
  const { user } = useAuth();
  const orders = useApi('/portal/orders');
  const invoices = useApi('/portal/invoices');
  const list = orders.data || [];
  const awaiting = list.filter((o) => o.status === 'quote');
  const active = list.filter((o) => ['confirmed', 'in_production', 'ready', 'shipped'].includes(o.status));
  const owed = (invoices.data || []).reduce((s, i) => s + (i.amount - i.paid), 0);

  return (
    <div>
      <div className="row between">
        <div><h1>{greeting(user.name)} 👋</h1><p className="muted">Here's where your orders stand.</p></div>
        <Link className="button primary" to="/portal/new">+ Request a quote</Link>
      </div>
      <div className="grid">
        <div className="card kpi"><span className="muted">Quotes awaiting your approval</span><strong><CountUp value={awaiting.length} /></strong></div>
        <div className="card kpi"><span className="muted">Orders in progress</span><strong><CountUp value={active.length} /></strong></div>
        <div className="card kpi"><span className="muted">Outstanding balance</span><strong><CountUp value={owed} format={(n) => money(n)} /></strong></div>
      </div>

      <DataTable rows={list} columns={[
        { key: 'order_no', label: 'Order', render: (o) => <Link to={`/portal/orders/${o.id}`}>{o.order_no}</Link> },
        { key: 'status', label: 'Status', render: (o) => <StatusBadge status={o.status} /> },
        { key: 'promised_date', label: 'Expected delivery', render: (o) => date(o.promised_date) },
        { key: 'total_amount', label: 'Total', num: true, render: (o) => money(o.total_amount) },
      ]} />

      <h3>Invoices</h3>
      <DataTable searchable={false} rows={invoices.data || []} empty="No invoices yet." columns={[
        { key: 'invoice_no', label: 'Invoice' }, { key: 'order_no', label: 'Order' },
        { key: 'due_date', label: 'Due', render: (i) => date(i.due_date) },
        { key: 'amount', label: 'Amount', num: true, render: (i) => money(i.amount) },
        { key: 'status', label: 'Status', render: (i) => <StatusBadge status={i.status} /> },
      ]} actions={(i) => <button onClick={() => openInvoicePdf(i.id)}>Download PDF</button>} />
    </div>
  );
}
