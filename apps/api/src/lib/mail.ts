import { APP_NAME } from '@app/shared';
import nodemailer from 'nodemailer';

const port = Number(process.env.SMTP_PORT || 587);

// Without SMTP_HOST mails go to the log, so local dev needs no mail account.
const transport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

const from = process.env.EMAIL_FROM || `${APP_NAME} <noreply@localhost>`;

type Mail = { to: string; subject: string; text: string; html: string };

export async function sendMail({ to, subject, text, html }: Mail) {
  if (!transport) {
    console.log(`[mail] To ${to}: ${subject}\n${text}`);
    return;
  }
  await transport.sendMail({ from, to, subject, text, html });
}

export function sendMagicLinkEmail(email: string, token: string, next: string | null) {
  const url = `${process.env.APP_URL}/auth/verify?token=${token}${next ? `&next=${encodeURIComponent(next)}` : ''}`;
  return sendMail({
    to: email,
    subject: `Dein Login-Link für ${APP_NAME}`,
    text: `Hier einloggen: ${url}\n\nDer Link gilt 15 Minuten. Wenn du ihn nicht angefordert hast, ignorier diese Mail.`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 460px; margin: 0 auto; padding: 2rem; color: #1a1a1a;">
        <h1 style="font-size: 1.4rem; margin: 0 0 1rem;">${APP_NAME}</h1>
        <p style="margin: 0 0 1.5rem;">Klick auf den Button, um dich einzuloggen:</p>
        <a href="${url}" style="display: inline-block; padding: 0.75rem 1.5rem; background: #1a1a1a; color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600;">Einloggen</a>
        <p style="color: #666; font-size: 0.85rem; margin: 1.5rem 0 0;">Der Link gilt 15 Minuten. Wenn du ihn nicht angefordert hast, ignorier diese Mail.</p>
      </div>
    `,
  });
}

export function sendLoginCodeEmail(email: string, code: string) {
  return sendMail({
    to: email,
    subject: `${code} ist dein Login-Code für ${APP_NAME}`,
    text: `Dein Code: ${code}\n\nEr gilt 15 Minuten. Wenn du ihn nicht angefordert hast, ignorier diese Mail.`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 460px; margin: 0 auto; padding: 2rem; color: #1a1a1a;">
        <h1 style="font-size: 1.4rem; margin: 0 0 1rem;">${APP_NAME}</h1>
        <p style="margin: 0 0 1rem;">Gib diesen Code in der App ein:</p>
        <p style="font-size: 2rem; font-weight: 700; letter-spacing: 0.3rem; margin: 0 0 1.5rem;">${code}</p>
        <p style="color: #666; font-size: 0.85rem; margin: 0;">Der Code gilt 15 Minuten. Wenn du ihn nicht angefordert hast, ignorier diese Mail.</p>
      </div>
    `,
  });
}
