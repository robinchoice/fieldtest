// See https://svelte.dev/docs/kit/types#app.d.ts
import type { Locale } from '@app/shared';

declare global {
  namespace App {
    interface Locals {
      locale: Locale;
    }
    interface PageData {
      locale: Locale;
    }
  }
}
