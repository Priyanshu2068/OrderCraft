import { useMemo, useState } from 'react';
import { Empty } from '../fun.jsx';

// columns: [{ key, label, render?(row), num?, sort?: false }]
export default function DataTable({ columns, rows, searchable = true, pageSize = 10, empty = 'Nothing here yet.', actions }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(null); // { key, dir }
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows || [];
    if (needle) out = out.filter((r) => columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(needle)));
    if (sort) {
      out = [...out].sort((a, b) => {
        const x = a[sort.key], y = b[sort.key];
        const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true });
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return out;
  }, [rows, q, sort, columns]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * pageSize, (current + 1) * pageSize);

  const toggleSort = (key) =>
    setSort((s) => (s?.key === key ? (s.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' }));

  return (
    <div>
      {searchable && (
        <input className="search" placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={`${c.num ? 'num' : ''} ${c.sort === false ? '' : 'sortable'}`}
                  onClick={c.sort === false ? undefined : () => toggleSort(c.key)}>
                  {c.label}{sort?.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              {actions && <th />}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={r.id ?? i}>
                {columns.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>)}
                {actions && <td className="actions">{actions(r)}</td>}
              </tr>
            ))}
            {!visible.length && <tr><td colSpan={columns.length + (actions ? 1 : 0)}><Empty title={q ? 'No matches' : empty}>{q ? 'Try a different search.' : ''}</Empty></td></tr>}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="row between pager">
          <span className="muted">{filtered.length} rows</span>
          <div className="row">
            <button disabled={current === 0} onClick={() => setPage(current - 1)}>‹ Prev</button>
            <span>{current + 1} / {pages}</span>
            <button disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next ›</button>
          </div>
        </div>
      )}
    </div>
  );
}
