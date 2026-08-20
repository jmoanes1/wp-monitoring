const TOKEN_KEY = 'wpmon_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api(path, { method = 'GET', body, headers } = {}) {
  const token = getToken();
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new Error('Cannot reach the API. Make sure the backend is running on port 5000.');
  }

  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== '/auth/login') {
    setToken(null);
    if (window.location.pathname !== '/login') {
      window.location.assign('/login');
    }
  }
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}
