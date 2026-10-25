import { useCallback, useEffect, useState } from 'react';

const TOKEN_KEY = 'ordercraft_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(getToken() && { Authorization: `Bearer ${getToken()}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && path !== '/auth/login') {
    setToken(null);
    localStorage.removeItem('ordercraft_user');
    window.location.assign('/');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error([data.error, ...(data.details || [])].filter(Boolean).join(': ') || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Fetches `path`; `reload()` refetches.
export function useApi(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(
    () => api('GET', path).then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message)),
    [path]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, reload };
}
