import {
  APP_BAND,
  APP_NAME,
  bandColor,
  DATE_LOCALE,
  DEEP,
  GLOW,
  type Locale,
  type Messages,
  messages,
  type UpdateContent,
} from '@app/shared';
import nodemailer from 'nodemailer';

const port = Number(process.env.SMTP_PORT || 587);

// Without SMTP_HOST mails go to the log, so local dev needs no mail account.
// In production the log would hand out login links, so the boot aborts.
if (!process.env.SMTP_HOST && process.env.NODE_ENV === 'production') {
  throw new Error('SMTP_HOST is required in production, otherwise login links would end up in the log');
}
if (!process.env.APP_URL && process.env.NODE_ENV === 'production') {
  throw new Error('APP_URL is required in production');
}

const transport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

const from = process.env.EMAIL_FROM || `${APP_NAME} <noreply@localhost>`;

type Mail = { to: string; subject: string; text: string; html: string; headers?: Record<string, string> };

export async function sendMail({ to, subject, text, html, headers }: Mail) {
  if (!transport) {
    console.log(`[mail] To ${to}: ${subject}\n${text}`);
    return;
  }
  await transport.sendMail({ from, to, subject, text, html, headers });
}

// The branded template, DESIGN.md „Mails“. Tables and inline styles, because
// Gmail and Outlook ignore most CSS. The product gradient comes as three cells
// or with a solid fallback, Outlook draws no gradients. The tile is a PNG
// (apps/web/static/mail-logo.png), mail clients show no SVG.
const MID = (APP_BAND.from + APP_BAND.to) / 2;
const [FROM, CENTER, TO] = [APP_BAND.from, MID, APP_BAND.to].map((p) => bandColor(p, GLOW)) as [string, string, string];
const LINK = bandColor(MID, DEEP);
const GRADIENT = `linear-gradient(45deg,${FROM},${CENTER},${TO})`;
const DISPLAY = `'Bricolage Grotesque','Arial Narrow',Arial,sans-serif`;
const BODY = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const TEXT = `font-family:${BODY};font-size:16px;line-height:1.55;color:#17171A`;
const SMALL = `font-family:${BODY};font-size:13px;line-height:1.6;color:#5E5E66`;
const SENDER_BAND = GLOW.map((color) => {
  const channels = [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16));
  return {
    light: `#${channels
      .map((channel) =>
        Math.round(channel * 0.4 + 255 * 0.6)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`,
    dark: `#${channels
      .map((channel) =>
        Math.round(channel * 0.45)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`,
  };
});

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const cells = (colors: string[], height: number, className = '') =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="${className}"><tr>${colors
    .map(
      (color) =>
        `<td bgcolor="${color}" height="${height}" style="height:${height}px;line-height:${height}px;font-size:0;background:${color}">&nbsp;</td>`,
    )
    .join('')}</tr></table>`;

function button(label: string, href: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${CENTER}" style="border-radius:10px;background:${CENTER};background-image:${GRADIENT}"><a href="${href}" style="display:inline-block;padding:14px 26px;font-family:${BODY};font-size:16px;font-weight:700;color:#17171A;text-decoration:none;border-radius:10px">${escapeHtml(label)}</a></td></tr></table>`;
}

function layout(texts: Messages, locale: Locale, preheader: string, body: string, footer: string) {
  const url = process.env.APP_URL;
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<style>
@font-face{font-family:'Bricolage Grotesque';font-weight:200 800;font-stretch:75% 100%;src:url('${url}/fonts/bricolage-grotesque-latin.woff2') format('woff2')}
body{margin:0;padding:0;-webkit-text-size-adjust:100%}
@media (max-width:620px){.px{padding-left:20px!important;padding-right:20px!important}.h1{font-size:26px!important}}
@media (prefers-color-scheme:dark){.bg{background:#0E0D12!important}.card{background:#16151B!important;border-color:rgba(255,255,255,.07)!important}.tx{color:#F2F0EA!important}.mu{color:#9A98A3!important}.ln{color:${CENTER}!important}${SENDER_BAND.map((color, index) => `.sender-band td:nth-child(${index + 1}){background:${color.dark}!important}`).join('')}}
</style></head>
<body class="bg" style="margin:0;padding:0;background:#F4F4F1">
<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" style="background:#F4F4F1"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
<tr><td style="padding:0 4px 18px"><a href="${url}" style="text-decoration:none"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding-right:12px"><img src="${url}/mail-logo.png" width="40" height="40" alt="" style="display:block;border:0;border-radius:10px"></td>
<td><div class="tx" style="font-family:${DISPLAY};font-stretch:78%;font-weight:780;font-size:24px;line-height:1;color:#17171A">${escapeHtml(APP_NAME)}</div><div style="height:5px;line-height:5px;font-size:0">&nbsp;</div><div style="width:96px">${cells([FROM, CENTER, TO], 4)}</div></td>
</tr></table></a></td></tr>
<tr><td class="card px" style="background:#FFFFFF;border:1px solid rgba(23,23,26,.12);border-radius:16px;padding:32px 36px">${body}</td></tr>
<tr><td class="px" style="padding:22px 8px 0"><div class="mu" style="${SMALL};font-size:12px">${footer}</div>
<div style="height:14px;line-height:14px;font-size:0">&nbsp;</div>
<a href="https://pleasance.org" class="mu" style="font-family:${DISPLAY};font-stretch:80%;font-weight:650;font-size:13px;color:#5E5E66;text-decoration:none">${escapeHtml(texts.madeBy)} <span class="tx" style="color:#17171A;font-weight:780">Pleasance</span></a>
<div style="width:150px;padding-top:3px">${cells(
    SENDER_BAND.map((color) => color.light),
    2,
    'sender-band',
  )}</div></td></tr>
</table></td></tr></table></body></html>`;
}

const heading = (title: string, margin = 10) =>
  `<h1 class="tx h1" style="margin:0 0 ${margin}px;font-family:${DISPLAY};font-stretch:80%;font-weight:780;font-size:30px;line-height:1.1;letter-spacing:-.3px;color:#17171A">${escapeHtml(title)}</h1>`;
const paragraph = (text: string, style = TEXT) => `<p class="tx" style="margin:0;${style}">${escapeHtml(text)}</p>`;
const space = (px: number) => `<div style="height:${px}px;line-height:${px}px;font-size:0">&nbsp;</div>`;

// With a ticked opt-in the login mail says so, opening the link is the
// confirmation of the double opt-in.
const optIn = (texts: Messages, updates: boolean) =>
  updates
    ? `${space(18)}<p class="tx" style="margin:0;${TEXT};font-size:14px">${escapeHtml(texts.optInNote(APP_NAME))}</p>`
    : '';
const optInText = (texts: Messages, updates: boolean) => (updates ? `\n\n${texts.optInNote(APP_NAME)}` : '');

type Login = { locale: Locale; updates: boolean };

export function sendMagicLinkEmail(email: string, token: string, next: string | null, { locale, updates }: Login) {
  const texts = messages[locale];
  const url = `${process.env.APP_URL}/auth/verify?token=${token}${next ? `&next=${encodeURIComponent(next)}` : ''}`;
  return sendMail({
    to: email,
    subject: texts.linkSubject(APP_NAME),
    text: `${texts.linkPlain} ${url}${optInText(texts, updates)}\n\n${texts.linkValid}\n\n--\n${texts.loginWhy}`,
    html: layout(
      texts,
      locale,
      texts.linkPrompt,
      `${heading(texts.linkSubject(APP_NAME))}${paragraph(texts.linkPrompt)}${space(22)}${button(texts.logIn, url)}${optIn(texts, updates)}${space(22)}<p class="mu" style="margin:0;${SMALL}">${escapeHtml(texts.linkValid)}</p>`,
      escapeHtml(texts.loginWhy),
    ),
  });
}

export function sendLoginCodeEmail(email: string, code: string, { locale, updates }: Login) {
  const texts = messages[locale];
  return sendMail({
    to: email,
    subject: texts.codeSubject(code, APP_NAME),
    text: `${texts.codePlain} ${code}${optInText(texts, updates)}\n\n${texts.codeValid}\n\n--\n${texts.loginWhy}`,
    html: layout(
      texts,
      locale,
      texts.codeSubject(code, APP_NAME),
      `${heading(texts.logIn)}${paragraph(texts.codePrompt)}${space(14)}<p class="tx" style="margin:0 0 18px;font-family:${DISPLAY};font-stretch:80%;font-weight:780;font-size:38px;letter-spacing:6px;color:#17171A">${code}</p><p class="mu" style="margin:0;${SMALL}">${escapeHtml(texts.codeValid)}</p>${optIn(texts, updates)}`,
      escapeHtml(texts.loginWhy),
    ),
  });
}

type UpdateMail = {
  id: string;
  content: UpdateContent;
  hasImage: boolean;
  // Date in the kicker, the send date or today for test mails and previews
  date: Date;
};

// The update in one language with its personal unsubscribe link. One-click
// unsubscribe (RFC 8058) lets Gmail and Apple Mail offer it next to the sender.
export function updateMail({ id, content, hasImage, date }: UpdateMail, locale: Locale, unsubscribeToken: string) {
  const url = process.env.APP_URL;
  const texts = messages[locale];
  const { title, features } = content[locale];
  const items = features.filter(Boolean);
  const day = new Intl.DateTimeFormat(DATE_LOCALE[locale], { dateStyle: 'long' }).format(date);
  const unsubscribePage = `${url}/unsubscribe?token=${unsubscribeToken}`;
  const settings = `${url}/settings`;

  const list = items
    .map(
      (item) =>
        `<tr><td valign="top" style="padding:7px 12px 7px 0"><div style="width:10px;height:10px;border-radius:5px;background:${CENTER};background-image:${GRADIENT};margin-top:7px"></div></td><td class="tx" style="padding:7px 0;${TEXT}">${escapeHtml(item)}</td></tr>`,
    )
    .join('');
  const image = hasImage
    ? `<img src="${url}/api/v1/updates/${id}/image" width="486" alt="" style="display:block;width:100%;max-width:486px;height:auto;border:0;border-radius:10px">${space(18)}`
    : '';
  const body = `<div class="mu" style="${SMALL};margin-bottom:8px">${escapeHtml(texts.updateKicker(APP_NAME))} · ${escapeHtml(day)}</div>${heading(title, 22)}${image}<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${list}</table>${space(26)}${button(texts.updateCta(APP_NAME), url!)}`;
  const footer = `${escapeHtml(texts.updateWhy(APP_NAME))}<br><a class="ln" href="${unsubscribePage}" style="color:${LINK};text-decoration:underline">${escapeHtml(texts.unsubscribe)}</a> &nbsp;·&nbsp; <a class="ln" href="${settings}" style="color:${LINK};text-decoration:underline">${escapeHtml(texts.settings)}</a>`;

  return {
    subject: texts.updateSubject(APP_NAME, title),
    html: layout(texts, locale, items.join(' · '), body, footer),
    text: [
      `${texts.updateKicker(APP_NAME)} · ${day}`,
      '',
      title,
      '',
      ...items.map((item) => `- ${item}`),
      '',
      `${texts.updateCta(APP_NAME)}: ${url}`,
      '',
      '--',
      texts.updateWhy(APP_NAME),
      `${texts.unsubscribe}: ${unsubscribePage}`,
      `${texts.settings}: ${settings}`,
    ].join('\n'),
    headers: {
      'List-Unsubscribe': `<${url}/api/v1/updates/unsubscribe?token=${unsubscribeToken}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}
