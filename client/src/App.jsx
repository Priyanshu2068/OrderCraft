import { useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import Track from './pages/Track.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Planning from './pages/Planning.jsx';
import Board from './pages/Board.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import Orders from './pages/Orders.jsx';
import NewOrder from './pages/NewOrder.jsx';
import OrderDetail from './pages/OrderDetail.jsx';
import Invoices from './pages/Invoices.jsx';
import PurchaseOrders from './pages/PurchaseOrders.jsx';
import BomEditor from './pages/BomEditor.jsx';
import CrudPage from './components/CrudPage.jsx';
import PortalHome from './pages/portal/PortalHome.jsx';
import PortalNew from './pages/portal/PortalNew.jsx';
import PortalOrder from './pages/portal/PortalOrder.jsx';

const customerCols = [
  { key: 'name', label: 'Name', required: true }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
  { key: 'discount_pct', label: 'Discount %', type: 'number', default: 0 },
  { key: 'billing_address', label: 'Billing address', hideInTable: true },
  { key: 'shipping_address', label: 'Shipping address', hideInTable: true },
];
const supplierCols = [
  { key: 'name', label: 'Name', required: true }, { key: 'email', label: 'Email' },
  { key: 'lead_time_days', label: 'Lead time (days)', type: 'number', default: 7 },
];
const productCols = [
  { key: 'sku', label: 'SKU', required: true }, { key: 'name', label: 'Name', required: true },
  { key: 'unit_price', label: 'Unit price', type: 'number', default: 0 },
  { key: 'lead_time_days', label: 'Lead time (days)', type: 'number', default: 5 },
];
const materialCols = [
  { key: 'code', label: 'Code', required: true }, { key: 'name', label: 'Name', required: true },
  { key: 'uom', label: 'UoM', default: 'pcs' },
  { key: 'stock_qty', label: 'Stock', type: 'number', default: 0 },
  { key: 'reorder_level', label: 'Reorder level', type: 'number', default: 0 },
  { key: 'unit_cost', label: 'Unit cost', type: 'number', default: 0 },
  { key: 'supplier_id', label: 'Supplier', type: 'select', optionsFrom: '/suppliers', hideInTable: true },
];

function useTheme() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'light');
  const toggle = () => {
    const t = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('ordercraft_theme', t); } catch { /* ignore */ }
    setTheme(t);
  };
  return [theme, toggle];
}

function Shell({ children, links, title, orderPath }) {
  const { user, logout } = useAuth();
  const [theme, toggleTheme] = useTheme();
  return (
    <div className="layout">
      <nav>
        <h2>🏭 OrderCraft{title && <small>{title}</small>}</h2>
        <button className="palette-btn" onClick={() => window.dispatchEvent(new Event('open-palette'))}>
          🔍 Search… <kbd>Ctrl K</kbd>
        </button>
        {links.map(([to, label, emoji, end]) => <NavLink key={to} to={to} end={end}><span>{emoji}</span> {label}</NavLink>)}
        <div className="spacer" />
        <div className="me"><span className="avatar">{user.name[0]}</span><div><b>{user.name}</b><small>{user.role}</small></div></div>
        <div className="row">
          <button onClick={toggleTheme} title="Toggle dark mode">{theme === 'dark' ? '☀️' : '🌙'}</button>
          <button className="grow" onClick={logout}>Log out</button>
        </div>
      </nav>
      <main key={useLocation().pathname} className="page">{children}</main>
      <CommandPalette orderPath={orderPath} pages={links.map(([to, label, emoji]) => [to, label, emoji])} />
    </div>
  );
}

function StaffApp() {
  const { can } = useAuth();
  const links = [
    ['/', 'Dashboard', '🏠', true], ['/board', 'Order board', '🗂️'], ['/orders', 'Orders', '🧾'], ['/planning', 'Planning', '🧭'],
    ['/customers', 'Customers', '🤝'], ['/products', 'Products', '📦'], ['/materials', 'Materials', '🔩'],
    ['/suppliers', 'Suppliers', '🚛'], ['/purchase-orders', 'Purchase orders', '🛒'], ['/invoices', 'Invoices', '💳'],
  ];
  return (
    <Shell links={links} orderPath="/orders">
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/board" element={<Board />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/new" element={<NewOrder />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/planning" element={<Planning />} />
        <Route path="/customers" element={<CrudPage title="Customers" path="/customers" columns={customerCols} canEdit={can('sales')} portalLogin={can('sales')} />} />
        <Route path="/suppliers" element={<CrudPage title="Suppliers" path="/suppliers" columns={supplierCols} canEdit={can('planner', 'warehouse')} />} />
        <Route path="/products" element={<CrudPage title="Products" path="/products" columns={productCols} canEdit={can('planner')} rowLink={(r) => ({ to: `/products/${r.id}/bom`, label: 'BOM' })} />} />
        <Route path="/products/:id/bom" element={<BomEditor />} />
        <Route path="/materials" element={<CrudPage title="Materials" path="/materials" columns={materialCols} canEdit={can('planner', 'warehouse')} />} />
        <Route path="/purchase-orders" element={<PurchaseOrders />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

function PortalApp() {
  return (
    <Shell title="Customer portal" orderPath="/portal/orders" links={[['/portal', 'My orders', '📬', true], ['/portal/new', 'Request a quote', '✨']]}>
      <Routes>
        <Route path="/portal" element={<PortalHome />} />
        <Route path="/portal/new" element={<PortalNew />} />
        <Route path="/portal/orders/:id" element={<PortalOrder />} />
        <Route path="*" element={<Navigate to="/portal" replace />} />
      </Routes>
    </Shell>
  );
}

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/track/:token" element={<Track />} />
      <Route path="*" element={!user ? <Login /> : user.role === 'customer' ? <PortalApp /> : <StaffApp />} />
    </Routes>
  );
}
