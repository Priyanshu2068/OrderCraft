import { api, getToken, useApi } from '../api.js';
import { useAuth } from '../auth.jsx';
import DataTable from '../components/DataTable.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { date, money } from '../format.js';
import { useToast } from '../toast.jsx';
import { celebrate } from '../fun.jsx';

export default function Invoices() {
  const { data, error, reload } = useApi('/invoices');
  const { can } = useAuth();
  const notify = useToast();

  async function pay(inv) {
    const balance = +(inv.amount - inv.paid).toFixed(2);
    const amount = Number(window.prompt(`Payment amount (balance ${balance})`, balance));
    if (!amount) return;
    try {
      const r = await api('POST', `/invoices/${inv.id}/payments`, { amount, method: 'bank transfer' });
      if (r.status === 'paid') { celebrate(true); notify('Paid in full 💰'); } else notify('Partial payment recorded');
      reload();
    }
    catch (err) { notify(err.message, 'error'); }
  }

  // PDF endpoint needs the bearer token, so fetch as a blob then open it.
  async function openPdf(inv) {
    const res = await fetch(`/api/invoices/${inv.id}/pdf`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) return notify('Could not load PDF', 'error');
    window.open(URL.createObjectURL(await res.blob()), '_blank');
  }

  return (
    <div>
      <h1>Invoices</h1>
      {error && <p className="error">{error}</p>}
      <DataTable rows={data || []} columns={[
        { key: 'invoice_no', label: 'Invoice' }, { key: 'order_no', label: 'Order' }, { key: 'customer_name', label: 'Customer' },
        { key: 'due_date', label: 'Due', render: (i) => date(i.due_date) },
        { key: 'amount', label: 'Amount', num: true, render: (i) => money(i.amount) },
        { key: 'paid', label: 'Paid', num: true, render: (i) => money(i.paid) },
        { key: 'status', label: 'Status', render: (i) => <StatusBadge status={i.status} /> },
      ]} actions={(i) => (
        <>
          <button onClick={() => openPdf(i)}>PDF</button>
          {i.status !== 'paid' && can('finance') && <button className="primary" onClick={() => pay(i)}>Record payment</button>}
        </>
      )} />
    </div>
  );
}
