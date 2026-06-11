const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const API_TIMEOUT_MS = 30000; // 30s for Render cold starts (was 15s)

function isLocalHost(hostname = '') {
  return LOCAL_HOSTS.has(String(hostname).toLowerCase());
}

function resolveApiUrl() {
  const configured = import.meta.env.VITE_API_URL?.trim();
  if (!configured) return '/api';
  if (configured.startsWith('/')) return configured;

  try {
    const url = new URL(configured, window.location.origin);
    if (isLocalHost(url.hostname) && !isLocalHost(window.location.hostname)) {
      return '/api';
    }
    return url.pathname.endsWith('/api') ? url.href : `${url.origin}/api`;
  } catch {
    return '/api';
  }
}

function resolveDefaultApiUrl() {
  if (import.meta.env.DEV) {
    const hostname = String(window.location.hostname || '').toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:5000/api';
    }
  }
  return '/api';
}

const API_URL = import.meta.env.VITE_API_URL?.trim() ? resolveApiUrl() : resolveDefaultApiUrl();

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
  const method = String(options.method || 'GET').toUpperCase();
  const hasBody = options.body !== undefined && options.body !== null;
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : API_TIMEOUT_MS;
  const shouldRetryOnce = method === 'GET';
  const maxAttempts = shouldRetryOnce ? 2 : 1;

  const headers = {
    ...(hasBody && !isFormData ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const body = hasBody
    ? (isFormData || typeof options.body === 'string' ? options.body : JSON.stringify(options.body))
    : undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    let mergedSignal = controller.signal;
    let cleanupMergedSignal = () => { };

    if (options.signal) {
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
        mergedSignal = AbortSignal.any([options.signal, controller.signal]);
      } else {
        const forwardAbort = () => controller.abort();
        if (options.signal.aborted) {
          controller.abort();
        } else {
          options.signal.addEventListener('abort', forwardAbort, { once: true });
          cleanupMergedSignal = () => options.signal.removeEventListener('abort', forwardAbort);
        }
        mergedSignal = controller.signal;
      }
    }

    try {
      const response = await fetch(`${API_URL}${path}`, {
        ...options,
        method,
        headers,
        body,
        signal: mergedSignal
      });
      window.clearTimeout(timeoutId);

      const isJson = String(response.headers.get('content-type') || '').includes('application/json');
      const data = isJson
        ? await response.json().then((parsed) => (parsed === null ? {} : parsed)).catch(() => ({}))
        : await response.text().catch(() => '');

      if (!response.ok) {
        const errorMessage = typeof data === 'object'
          ? data?.message || data?.error
          : String(data || '').trim();
        const error = new Error(
          errorMessage
          || (response.status === 413
            ? 'La capture est trop volumineuse. Réduis la taille de l’image et réessaie.'
            : `Échec de la requête (${response.status})`)
        );
        error.statusCode = response.status;
        if (response.status === 401) {
          clearSession();
          window.dispatchEvent(new CustomEvent('skill2cash:auth-expired'));
        }
        throw error;
      }

      if (response.status === 204) return {};
      return typeof data === 'object' ? data : { message: data };
    } catch (error) {
      window.clearTimeout(timeoutId);
      const isTimeout = error?.name === 'AbortError';
      const isNetworkError = error instanceof TypeError;
      const canRetry = attempt < maxAttempts && (isTimeout || isNetworkError);
      if (canRetry) continue;
      if (isTimeout) {
        throw new Error('La requête a pris trop de temps. Vérifie ta connexion puis réessaie.');
      }
      if (isNetworkError) {
        throw new Error('Connexion réseau indisponible. Vérifie Internet puis réessaie.');
      }
      throw error;
    } finally {
      cleanupMergedSignal();
    }
  }
}

export async function registerQuick(email, password, efootballUsername) {
  const response = await api('/auth/register-quick', {
    method: 'POST',
    body: { email, password, efootballUsername }
  });

  if (response.token) {
    setSession(response);
  }
  return response;
}

export async function completeProfile(updates) {
  const response = await api('/auth/complete-profile', {
    method: 'PATCH',
    body: updates
  });
  return response;
}

export { API_URL };
