import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

// Ctrl/Cmd+K: jump anywhere. `pages` = [[path, label, emoji]]
export default function CommandPalette({ pages, orderPath }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [orders, setOrders] = useState([]);
  const [idx, setIdx] = useState(0);
  const nav = useNavigate();
  const input = useRef();

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === 'Escape') setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('open-palette', onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('open-palette', onOpen); };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ(''); setIdx(0);
    setTimeout(() => input.current?.focus(), 0);
    api('GET', orderPath).then(setOrders).catch(() => {});
  }, [open, orderPath]);

  const items = useMemo(() => {
    const all = [
      ...pages.map(([to, label, emoji]) => ({ to, label, emoji, hint: 'Page' })),
      ...orders.map((o) => ({
        to: `${orderPath === '/orders' ? '/orders' : '/portal/orders'}/${o.id}`,
        label: `${o.order_no}${o.customer_name ? ` · ${o.customer_name}` : ''}`, emoji: '🧾', hint: o.status.replace('_', ' '),
      })),
    ];
    const n = q.trim().toLowerCase();
    return (n ? all.filter((i) => i.label.toLowerCase().includes(n) || i.hint.includes(n)) : all).slice(0, 8);
  }, [q, pages, orders, orderPath]);

  function go(item) { if (item) { nav(item.to); setOpen(false); } }

  if (!open) return null;
  return (
    <div className="modal palette-bg" onMouseDown={() => setOpen(false)}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input ref={input} value={q} placeholder="Jump to a page or order…" onChange={(e) => { setQ(e.target.value); setIdx(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
            if (e.key === 'Enter') go(items[idx]);
          }} />
        {items.map((i, k) => (
          <div key={i.to} className={`palette-item ${k === idx ? 'on' : ''}`} onMouseEnter={() => setIdx(k)} onClick={() => go(i)}>
            <span>{i.emoji} {i.label}</span><small className="muted">{i.hint}</small>
          </div>
        ))}
        {!items.length && <div className="muted palette-item">Nothing matches “{q}”</div>}
      </div>
    </div>
  );
}
