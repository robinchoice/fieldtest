import type { User } from '@app/shared';
import { api } from './api';

export const auth = $state({ user: null as User | null });

// Pages that depend on the login call this on mount. The verify page doesn't,
// so a stale "logged out" answer can't race its fresh session.
export async function checkAuth() {
  auth.user = (await api.get<{ user: User | null }>('/auth/me', true).catch(() => ({ user: null }))).user;
}

export function sendMagicLink(email: string, next: string | null) {
  return api.post('/auth/magic-link', { email, next: next ?? undefined });
}

// Silent: the verify page shows the error itself
export async function verify(token: string) {
  auth.user = (await api.post<{ user: User }>('/auth/verify', { token }, true)).user;
}

export async function logout() {
  await api.post('/auth/logout');
  auth.user = null;
}

export async function updateName(name: string) {
  auth.user = (await api.patch<{ user: User }>('/auth/me', { name })).user;
}
