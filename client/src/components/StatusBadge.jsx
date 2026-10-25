import { STAGE_LABEL } from '../format.js';

export const STAGE_EMOJI = {
  quote: '📝', draft: '📝', confirmed: '✅', in_production: '🏭', ready: '📦', shipped: '🚚',
  invoiced: '🧾', paid: '💰', cancelled: '🚫', open: '📬', received: '📥', unpaid: '⏳', partial: '🌓',
};

export default function StatusBadge({ status }) {
  return <span className={`badge ${status}`}>{STAGE_EMOJI[status]} {STAGE_LABEL[status] ?? status}</span>;
}
