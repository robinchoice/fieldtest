import { z } from 'zod';
import { page } from '$app/state';
import { toastError } from './toast.svelte';

const errorAnswer = z.object({ error: z.string(), code: z.string().exactOptional() });

// The last failed calls, newest first. Feedback sends them along.
export const recentErrors: string[] = [];

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function noteError(method: string, path: string, status: number | string) {
  recentErrors.unshift(`${method} /api/v1${path} → ${status}`);
  recentErrors.length = Math.min(recentErrors.length, 5);
}

// The API answers errors as { error: string } in the current language; they
// show up as a toast unless silent.
async function request<T>(method: string, path: string, body?: unknown, silent = false): Promise<T> {
  const headers: Record<string, string> = { 'accept-language': page.data.locale ?? 'de' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? null : JSON.stringify(body),
  }).catch((err) => {
    noteError(method, path, 'offline');
    throw err;
  });

  if (!res.ok) {
    noteError(method, path, res.status);
    const answer = errorAnswer.safeParse(await res.json().catch(() => null));
    const { error, code } = answer.data ?? { error: res.statusText };
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
