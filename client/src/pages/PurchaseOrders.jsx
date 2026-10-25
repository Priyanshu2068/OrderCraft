import { api, useApi } from '../api.js';
import { useAuth } from '../auth.jsx';
import DataTable from '../components/DataTable.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { date } from '../format.js';
import { useToast } from '../toast.jsx';

export default function PurchaseOrders() {
  const { data, error, reload } = useApi('/purchase-orders');
  const { can } = useAuth();
  const notify = useToast();

  async function receive(po) {
    try { await api('POST', `/purchase-orders/${po.id}/receive`); notify(`PO-${po.id} received into stock`); reload(); }
    catch (err) { notify(err.message, 'error'); }
  }

  return (
    <div>
      <h1>Purchase orders</h1>
      {error && <p className="error">{error}</p>}
      <DataTable rows={(data || []).map((po) => ({ ...po, number: `PO-${po.id}`, summary: po.items.map((i) => `${i.code} × ${i.qty}`).join(', ') }))} columns={[
        { key: 'number', label: 'PO' }, { key: 'supplier_name', label: 'Supplier' }, { key: 'summary', label: 'Items' },
        { key: 'expected_date', label: 'Expected', render: (po) => date(po.expected_date) },
        { key: 'status', label: 'Status', render: (po) => <StatusBadge status={po.status} /> },
      ]} actions={(po) => po.status === 'open' && can('warehouse', 'planner') && (
        <button className="primary" onClick={() => receive(po)}>Receive</button>
      )} />
      <p className="muted">Raise purchase orders from an order's page (shortages) or from Planning (reorder suggestions).</p>
    </div>
  );
}
