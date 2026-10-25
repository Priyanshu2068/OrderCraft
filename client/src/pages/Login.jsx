import { useState } from 'react';
import { useAuth } from '../auth.jsx';

const DEMOS = [
  ['👑', 'Owner', 'admin@ordercraft.test'],
  ['💼', 'Sales', 'sales@ordercraft.test'],
  ['🧭', 'Planner', 'planner@ordercraft.test'],
  ['🛍️', 'Customer', 'customer@acme.test'],
];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('admin@ordercraft.test');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try { await login(email, password); } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <div className="login-page">
      <div className="login-hero">
        <div className="blob b1" /><div className="blob b2" /><div className="blob b3" />
        <h1>🏭 OrderCraft</h1>
        <p className="tag">Know exactly when you'll deliver —<br />and let your customers see it.</p>
        <ul>
          <li>📅 A promise date on every quote</li>
          <li>🗂️ Drag-and-drop order board</li>
          <li>🛍️ A portal your customers will actually use</li>
        </ul>
      </div>
      <form onSubmit={submit} className="login-form">
        <h2>Welcome back 👋</h2>
        <p className="muted">Sign in to keep things moving.</p>
        <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
        {error && <p className="error">{error}</p>}
        <button className="primary big" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted">Or try a demo account <small>(password <code>password123</code>)</small></p>
        <div className="demo-grid">
          {DEMOS.map(([emoji, label, e]) => (
            <button type="button" key={e} className={email === e ? 'on' : ''} onClick={() => setEmail(e)}>{emoji} {label}</button>
          ))}
        </div>
      </form>
    </div>
  );
}
