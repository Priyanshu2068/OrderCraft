import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi } from '../api.js';
import { useToast } from '../toast.jsx';
import DataTable from './DataTable.jsx';

// Generic list + add/edit/delete page for master data.
// column: { key, label, type?: 'number'|'select', required?, default?, optionsFrom?, hideInTable? }
export default function CrudPage({ title, path, columns, canEdit, rowLink, portalLogin }) {
  const { data, error, reload } = useApi(path);
  const notify = useToast();
  const [editing, setEditing] = useState(null); // null | row | blank row
  const [formError, setFormError] = useState('');

  const blank = () => Object.fromEntries(columns.map((c) => [c.key, c.default ?? '']));

  async function save(e) {
    e.preventDefault();
    setFormError('');
    const body = {};
    for (const c of columns) {
      const v = editing[c.key];
      body[c.key] = c.type === 'number' || c.type === 'select' ? (v === '' || v == null ? null : Number(v)) : v ?? '';
    }
    try {
      if (editing.id) await api('PUT', `${path}/${editing.id}`, body);
      else await api('POST', path, body);
      setEditing(null);
      notify('Saved');
      reload();
    } catch (err) {
      setFormError(err.message);
    }
  }

  async function remove(row) {
    if (!window.confirm('Delete this record?')) return;
    try { await api('DELETE', `${path}/${row.id}`); notify('Deleted'); reload(); } catch (err) { notify(err.message, 'error'); }
  }

  async function createPortalLogin(row) {
    const email = window.prompt(`Portal login email for ${row.name}`, row.email || '');
    if (!email) return;
    const password = window.prompt('Initial password (min 8 characters)');
    if (!password) return;
    try { await api('POST', `${path}/${row.id}/portal-user`, { email, password }); notify(`Portal login created for ${email}`); }
    catch (err) { notify(err.message, 'error'); }
  }

  return (
    <div>
      <div className="row between">
        <h1>{title}</h1>
        {canEdit && <button className="primary" onClick={() => setEditing(blank())}>+ Add</button>}
      </div>
      {error && <p className="error">{error}</p>}
      <DataTable
        rows={data || []}
        columns={columns.filter((c) => !c.hideInTable).map(({ key, label, type }) => ({ key, label, num: type === 'number' }))}
        actions={(row) => (
          <>
            {rowLink && <Link className="button" to={rowLink(row).to}>{rowLink(row).label}</Link>}
            {portalLogin && <button onClick={() => createPortalLogin(row)}>Portal login</button>}
            {canEdit && <button onClick={() => setEditing(row)}>Edit</button>}
            {canEdit && <button className="danger" onClick={() => remove(row)}>Delete</button>}
          </>
        )}
      />
      {editing && (
        <div className="modal">
          <form onSubmit={save} className="card">
            <h3>{editing.id ? 'Edit' : 'Add'} {title.toLowerCase()}</h3>
            {columns.map((c) => (
              <label key={c.key}>
                {c.label}
                {c.type === 'select' ? (
                  <Select path={c.optionsFrom} value={editing[c.key] ?? ''} onChange={(v) => setEditing({ ...editing, [c.key]: v })} />
                ) : (
                  <input
                    type={c.type === 'number' ? 'number' : 'text'} step="any" required={c.required}
                    value={editing[c.key] ?? ''} onChange={(e) => setEditing({ ...editing, [c.key]: e.target.value })}
                  />
                )}
              </label>
            ))}
            {formError && <p className="error">{formError}</p>}
            <div className="row">
              <button className="primary" type="submit">Save</button>
              <button type="button" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Select({ path, value, onChange }) {
  const { data } = useApi(path);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— none —</option>
      {(data || []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}
