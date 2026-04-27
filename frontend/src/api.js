const API_URL = import.meta.env.VITE_API_URL || '/api';

export function getSocketUrl() {
  if (import.meta.env.VITE_SOCKET_URL) return import.meta.env.VITE_SOCKET_URL;
  try {
    return new URL(API_URL, window.location.origin).origin;
  } catch {
    return window.location.origin;
  }
}

export function getToken() {
  return localStorage.getItem('skill2cash_token');
}

export function setSession({ token, user }) {
  localStorage.setItem('skill2cash_token', token);
  localStorage.setItem('skill2cash_user', JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem('skill2cash_token');
  localStorage.removeItem('skill2cash_user');
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('skill2cash_user'));
  } catch {
    return null;
  }
}

export async function api(path, options = {}) {
  const token = getToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || 'Échec de la requête');
    error.statusCode = response.status;
    if (response.status === 401) {
      clearSession();
      window.dispatchEvent(new CustomEvent('skill2cash:auth-expired'));
    }
    throw error;
  }
  return data;
}

export { API_URL };
