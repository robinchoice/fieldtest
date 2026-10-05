export type Toast = { id: string; message: string; type: 'info' | 'error' };

export const toasts = $state<Toast[]>([]);

export function toast(message: string, type: Toast['type'] = 'info', duration = 4000) {
  const id = crypto.randomUUID();
  toasts.push({ id, message, type });
  setTimeout(() => removeToast(id), duration);
}

export function removeToast(id: string) {
  const index = toasts.findIndex((t) => t.id === id);
  if (index !== -1) toasts.splice(index, 1);
}

export const toastError = (message: string) => toast(message, 'error', 6000);
