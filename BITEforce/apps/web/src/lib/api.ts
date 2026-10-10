const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1';
let accessToken: string | null = null;
export const setAccessToken = (token: string | null) => { accessToken = token; };
export const getAccessToken = () => accessToken;

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  let response: Response;
  try { response = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' }); }
  catch { throw new ApiError('The API could not be reached. Check that the backend is running.', 0); }
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json().catch(() => null) : await response.text().catch(() => '');
  if (!response.ok) {
    const message = typeof payload?.message === 'string' ? payload.message : Array.isArray(payload?.message) ? payload.message.join(' ') : `Request failed (${response.status}).`;
    throw new ApiError(message, response.status);
  }
  return payload as T;
}
export const get = <T = any>(path: string) => api<T>(path);
export const post = <T = any>(path: string, body?: any) => api<T>(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body ?? {}) });
export const patch = <T = any>(path: string, body?: any) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });
export function prettyError(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
