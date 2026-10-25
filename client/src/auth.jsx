import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const readUser = () => {
  try { return getToken() ? JSON.parse(localStorage.getItem('ordercraft_user')) : null; } catch { return null; }
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readUser);

  // Sessions last 30 days; confirm the saved one quietly on load (api() clears it on a 401).
  useEffect(() => {
    if (user) api('GET', '/auth/me').catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function login(email, password) {
    const { token, user: u } = await api('POST', '/auth/login', { email, password });
    setToken(token);
    localStorage.setItem('ordercraft_user', JSON.stringify(u));
    setUser(u);
  }
  function logout() {
    setToken(null);
    localStorage.removeItem('ordercraft_user');
    setUser(null);
  }
  // UI hint only; the server enforces roles.
  const can = (...roles) => !!user && (user.role === 'admin' || roles.includes(user.role));

  return <AuthContext.Provider value={{ user, login, logout, can }}>{children}</AuthContext.Provider>;
}
