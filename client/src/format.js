export const money = (n) =>
  Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const date = (d) => (d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export const dateTime = (d) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const STAGES = ['quote', 'confirmed', 'in_production', 'ready', 'shipped', 'invoiced', 'paid'];

// customer-friendly wording
export const STAGE_LABEL = {
  quote: 'Quote', draft: 'Draft', confirmed: 'Confirmed', in_production: 'In production', ready: 'Ready to ship',
  shipped: 'Shipped', invoiced: 'Invoiced', paid: 'Paid', cancelled: 'Cancelled',
};

export const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
