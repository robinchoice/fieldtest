import { DATE_LOCALE, type Locale, messages } from '@app/shared';
import { invalidateAll } from '$app/navigation';
import { page } from '$app/state';

// Texts in the current language, e.g. {t().save}. hooks.server.ts takes the
// language from the cookie, else from the browser.
export const t = () => messages[page.data.locale ?? 'de'];

export async function setLocale(locale: Locale) {
  // biome-ignore lint/suspicious/noDocumentCookie: cookieStore needs HTTPS, dev over a LAN address has none
  document.cookie = `locale=${locale}; path=/; max-age=31536000; samesite=lax`;
  await invalidateAll();
  document.documentElement.lang = locale;
}

const NUMBER_LOCALE = { de: 'de-DE', en: 'en-US' };

export const sats = (n: number) => n.toLocaleString(NUMBER_LOCALE[page.data.locale ?? 'de']);

export const date = (
  value: string | Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
) => new Date(value).toLocaleString(DATE_LOCALE[page.data.locale ?? 'de'], options);

// "in 31 hours", "4 minutes ago"
export function relative(date: string | Date) {
  const seconds = (new Date(date).getTime() - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat(page.data.locale ?? 'de', { numeric: 'auto' });
  for (const [unit, size] of [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ] as const) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(Math.round(seconds), 'second');
}

export const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
