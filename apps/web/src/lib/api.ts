import { page } from '$app/state';
import { toastError } from './toast.svelte';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// The API answers errors as { error: string } in the current language; they
// show up as a toast unless silent.
async function request<T>(method: string, path: string, body?: unknown, silent = false): Promise<T> {
  const headers: Record<string, string> = { 'accept-language': page.data.locale ?? 'de' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    const { error, code } = await res.json().catch(() => ({ error: res.statusText }));
    if (!silent) toastError(error);
    throw new ApiError(error, code);
  }
  return res.json();
}

export const api = {
  get: <T>(path: string, silent = false) => request<T>('GET', path, undefined, silent),
  post: <T>(path: string, body?: unknown, silent = false) => request<T>('POST', path, body, silent),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
