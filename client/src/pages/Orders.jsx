import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../api.js';
import { useAuth } from '../auth.jsx';
import DataTable from '../components/DataTable.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { date, money, STAGE_LABEL } from '../format.js';

const STATUSES = ['quote', 'confirmed', 'in_production', 'ready', 'shipped', 'invoiced', 'paid', 'cancelled'];

export default function Orders() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const { data, error } = useApi(`/orders${status ? `?status=${status}` : ''}`);
  const { can } = useAuth();
  return (
    <div>
      <div className="row between">
        <h1>Orders</h1>
        <div className="row">
          <select value={status} onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
          {can('sales') && <Link className="button primary" to="/orders/new">+ New quote</Link>}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <DataTable rows={data || []} columns={[
        { key: 'order_no', label: 'Order', render: (o) => <Link to={`/orders/${o.id}`}>{o.order_no}</Link> },
        { key: 'customer_name', label: 'Customer' },
        { key: 'status', label: 'Status', render: (o) => <StatusBadge status={o.status} /> },
        { key: 'due_date', label: 'Customer wants', render: (o) => date(o.due_date) },
        { key: 'promised_date', label: 'We promise', render: (o) => <span className={o.late_risk ? 'error' : ''}>{date(o.promised_date)}{o.late_risk ? ' ⚠' : ''}</span> },
        { key: 'total_amount', label: 'Total', num: true, render: (o) => money(o.total_amount) },
      ]} />
    </div>
  );
}
