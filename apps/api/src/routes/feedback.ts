import { appFeedback } from '@app/db';
import { type FeedbackContext, feedbackSchema, type User } from '@app/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createIssue } from '../lib/github';
import { t } from '../lib/i18n';
import { imageType, UUID } from '../lib/image';
import { sendMail } from '../lib/mail';
import { rateLimit, tooManyRequests } from '../lib/rate-limit';
import { validJson } from '../lib/validate';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { captureException } from '../monitoring';
import type { AppEnv } from '../types';

const reportsPerUser = rateLimit('feedback-per-user', 10, 60 * 60 * 1000);

type Report = {
  id: string;
  user: User;
  kind: 'bug' | 'idea';
  message: string;
  context: FeedbackContext & { api: string };
};

const firstLine = (message: string) => {
  const line = message.split('\n')[0]!;
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
};

// Developer-facing, so English like the rest of the repo
function details({ id, user, context }: Report) {
  return [
    ['Page', context.page],
    ['Version', context.api],
    ['Device', context.device],
    ['Window', context.viewport],
    ['Language', context.locale],
    ['Recent errors', context.errors.join(', ') || '–'],
    ['Tester', user.id],
    ['Feedback', id],
  ];
}

// No email address in the issue: others with access to the repo may read it.
// Replies go through the mail.
function issue(report: Report) {
  const cell = (value: string) => value.replace(/[|\n\r`]/g, ' ');
  return {
    title: `Feedback: ${firstLine(report.message)}`,
    body: [
      report.message
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n'),
      `| | |\n|---|---|\n${details(report)
        .map(([key, value]) => `| ${key} | \`${cell(value!)}\` |`)
        .join('\n')}`,
    ].join('\n\n'),
    labels: ['feedback', report.kind, report.context.platform],
  };
}

// Answering the mail reaches the tester.
function mail(report: Report, to: string, issueUrl: string | null, screenshot: Buffer | null) {
  const type = screenshot && imageType(screenshot);
  return {
    to,
    replyTo: { name: report.user.name, address: report.user.email },
    subject: `${report.kind === 'bug' ? 'Bug' : 'Idea'} from ${report.user.name}: ${firstLine(report.message)}`,
    text: [
      report.message,
      '--',
      `${report.user.name} <${report.user.email}>`,
      ...details(report).map(([key, value]) => `${key}: ${value}`),
      ...(issueUrl ? [`Issue: ${issueUrl}`] : []),
    ].join('\n'),
    attachments: screenshot
      ? [{ filename: `screenshot.${type === 'image/png' ? 'png' : 'jpg'}`, content: screenshot }]
      : [],
  };
}

export const feedbackRoutes = new Hono<AppEnv>()
  // Stored first, so a failing mail or GitHub loses nothing
  .post('/', requireAuth, validJson(feedbackSchema), async (c) => {
    const user = c.get('user');
    if (!(await reportsPerUser.hit(c, user.id))) return tooManyRequests(c);
    const { kind, message, context, screenshot: base64 } = c.req.valid('json');
    const screenshot = base64 ? Buffer.from(base64, 'base64') : null;
    if (screenshot && !imageType(screenshot)) return c.json({ error: t(c).invalidImage }, 400);

    const db = c.get('db');
    const fullContext = { ...context, api: process.env.APP_VERSION || 'dev' };
    const [row] = await db
      .insert(appFeedback)
      .values({ userId: user.id, kind, message, screenshot, context: fullContext })
      .returning({ id: appFeedback.id });
    const report: Report = {
      id: row!.id,
      user,
      kind,
      message,
      context: fullContext,
    };

    let issueUrl: string | null = null;
    try {
      issueUrl = await createIssue(issue(report));
      if (issueUrl) await db.update(appFeedback).set({ issueUrl }).where(eq(appFeedback.id, report.id));
    } catch (err) {
      console.error('Feedback issue failed:', err);
      captureException(err);
    }
    const to = process.env.FEEDBACK_EMAIL;
    try {
      if (to) await sendMail(mail(report, to, issueUrl, screenshot));
    } catch (err) {
      console.error('Feedback mail failed:', err);
      captureException(err);
    }
    return c.json({ ok: true });
  })

  .get('/:id/screenshot', requireAuth, requireAdmin, async (c) => {
    const id = c.req.param('id');
    const [row] = UUID.test(id)
      ? await c.get('db').select({ screenshot: appFeedback.screenshot }).from(appFeedback).where(eq(appFeedback.id, id))
      : [];
    if (!row?.screenshot) return c.json({ error: t(c).notFound }, 404);
    return c.body(new Uint8Array(row.screenshot), 200, {
      'content-type': imageType(row.screenshot)!,
      'cache-control': 'no-store',
    });
  });
