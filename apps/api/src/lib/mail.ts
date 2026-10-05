import { APP_NAME, type Messages } from '@app/shared';
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

export function sendMagicLinkEmail(email: string, token: string, next: string | null, m: Messages) {
  const url = `${process.env.APP_URL}/auth/verify?token=${token}${next ? `&next=${encodeURIComponent(next)}` : ''}`;
  return sendMail({
    to: email,
    subject: m.linkSubject(APP_NAME),
    text: `${m.linkPlain} ${url}\n\n${m.linkValid}`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 460px; margin: 0 auto; padding: 2rem; color: #1a1a1a;">
        <h1 style="font-size: 1.4rem; margin: 0 0 1rem;">${APP_NAME}</h1>
        <p style="margin: 0 0 1.5rem;">${m.linkPrompt}</p>
        <a href="${url}" style="display: inline-block; padding: 0.75rem 1.5rem; background: #1a1a1a; color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600;">${m.logIn}</a>
        <p style="color: #666; font-size: 0.85rem; margin: 1.5rem 0 0;">${m.linkValid}</p>
      </div>
    `,
  });
}

export function sendLoginCodeEmail(email: string, code: string, m: Messages) {
  return sendMail({
    to: email,
    subject: m.codeSubject(code, APP_NAME),
    text: `${m.codePlain} ${code}\n\n${m.codeValid}`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 460px; margin: 0 auto; padding: 2rem; color: #1a1a1a;">
        <h1 style="font-size: 1.4rem; margin: 0 0 1rem;">${APP_NAME}</h1>
        <p style="margin: 0 0 1rem;">${m.codePrompt}</p>
        <p style="font-size: 2rem; font-weight: 700; letter-spacing: 0.3rem; margin: 0 0 1.5rem;">${code}</p>
        <p style="color: #666; font-size: 0.85rem; margin: 0;">${m.codeValid}</p>
      </div>
    `,
  });
}
