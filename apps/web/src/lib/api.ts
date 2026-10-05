import { toastError } from './toast.svelte';

// The API answers errors as { error: string }; they show up as a toast unless silent.
async function request<T>(method: string, path: string, body?: unknown, silent = false): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: res.statusText }));
    if (!silent) toastError(error);
    throw new Error(error);
  }
  return res.json();
}

export const api = {
  get: <T>(path: string, silent = false) => request<T>('GET', path, undefined, silent),
  post: <T>(path: string, body?: unknown, silent = false) => request<T>('POST', path, body, silent),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
