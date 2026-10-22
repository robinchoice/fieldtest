import type { Passkey, User } from '@app/shared';
import {
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  sendSignal,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { ApiError, api } from './api';

export const auth = $state({ user: null as User | null });

// Pages that depend on the login call this on mount. The verify page doesn't,
// so a stale "logged out" answer can't race its fresh session.
export async function checkAuth() {
  auth.user = (await api.get<{ user: User | null }>('/auth/me', true).catch(() => ({ user: null }))).user;
}

// updates: the unticked checkbox for update mails, counts once the link is opened.
// altcha: the payload of the widget in the form.
export function sendMagicLink(email: string, next: string | null, updates: boolean, altcha: string) {
  return api.post('/auth/magic-link', { email, next: next ?? undefined, updates, altcha });
}

// Silent: the verify page shows the error itself
export async function verify(token: string) {
  auth.user = (await api.post<{ user: User }>('/auth/verify', { token }, true)).user;
}

// The code from the same mail, for when the link opens in another browser
export async function verifyCode(email: string, code: string) {
  auth.user = (await api.post<{ user: User }>('/auth/code/verify', { email, code, cookie: true })).user;
}

// autofill: the conditional request behind the address field, silent until
// the user picks a passkey there. The button asks right away.
export async function passkeyLogin(autofill: boolean, signal: AbortSignal) {
  signal.throwIfAborted();
  const options = await api.post<PublicKeyCredentialRequestOptionsJSON>(
    '/auth/passkeys/login/options',
    undefined,
    autofill,
  );
  signal.throwIfAborted();
  const response = await startAuthentication({ optionsJSON: options, useBrowserAutofill: autofill });
  signal.throwIfAborted();
  try {
    auth.user = (await api.post<{ user: User }>('/auth/passkeys/login', { response, cookie: true })).user;
  } catch (err) {
    // Removed in the settings, still on the device: the browser may forget it
    if (err instanceof ApiError && err.code === 'passkeyUnknown')
      sendSignal({ signalName: 'unknownCredential', rpID: options.rpId!, credentialID: response.id }).catch(() => {});
    throw err;
  }
}

export async function listPasskeys() {
  return (await api.get<{ passkeys: Passkey[] }>('/auth/passkeys')).passkeys;
}

export async function addPasskey() {
  const options = await api.post<PublicKeyCredentialCreationOptionsJSON>('/auth/passkeys/register/options');
  const response = await startRegistration({ optionsJSON: options });
  return (await api.post<{ passkey: Passkey }>('/auth/passkeys/register', { response })).passkey;
}

export function removePasskey(id: string) {
  return api.delete(`/auth/passkeys/${encodeURIComponent(id)}`);
}

export async function logout() {
  await api.post('/auth/logout');
  auth.user = null;
}

export async function updateName(name: string) {
  auth.user = (await api.patch<{ user: User }>('/auth/me', { name })).user;
}

export async function setUpdates(updates: boolean) {
  auth.user = (await api.patch<{ user: User }>('/auth/me', { updates })).user;
}

export function invite(email: string) {
  return api.post('/auth/invite', { email });
}
