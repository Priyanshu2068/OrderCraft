import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, useApi } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function BomEditor() {
  const { id } = useParams();
  const product = useApi(`/products/${id}`).data;
  const bom = useApi(`/products/${id}/bom`);
  const materials = useApi('/materials').data || [];
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (bom.data) setRows(bom.data.map((b) => ({ material_id: b.material_id, qty_per_unit: b.qty_per_unit })));
  }, [bom.data]);

  const setRow = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setMsg('');
    try {
      await api('PUT', `/products/${id}/bom`, rows.map((r) => ({ material_id: Number(r.material_id), qty_per_unit: Number(r.qty_per_unit) })));
      setMsg('Saved');
      bom.reload();
    } catch (err) { setMsg(err.message); }
  }

  const editable = can('planner');
  return (
    <div>
      <div className="row between">
        <h1>BOM — {product?.sku} {product?.name}</h1>
        <Link to="/products">← Products</Link>
      </div>
      {rows.map((r, i) => (
        <div className="row" key={i}>
          <select disabled={!editable} value={r.material_id} onChange={(e) => setRow(i, { material_id: e.target.value })}>
            <option value="">Material…</option>
            {materials.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name} ({m.uom})</option>)}
          </select>
          <input disabled={!editable} type="number" step="any" min="0" value={r.qty_per_unit} onChange={(e) => setRow(i, { qty_per_unit: e.target.value })} />
          {editable && <button onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>}
        </div>
      ))}
      {editable && (
        <div className="row">
          <button onClick={() => setRows([...rows, { material_id: '', qty_per_unit: 1 }])}>+ Add material</button>
          <button className="primary" onClick={save}>Save BOM</button>
        </div>
      )}
      {msg && <p className={msg === 'Saved' ? 'muted' : 'error'}>{msg}</p>}
    </div>
  );
}
