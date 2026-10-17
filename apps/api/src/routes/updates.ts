import { updateDeliveries, updates, users } from '@app/db';
import { type Locale, saveUpdateSchema, type UpdateSummary, updateComplete } from '@app/shared';
import { and, count, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { t } from '../lib/i18n';
import { imageType, UUID } from '../lib/image';
import { sendMail, updateMail } from '../lib/mail';
import { clientIp, rateLimit, tooManyRequests } from '../lib/rate-limit';
import { redact } from '../lib/updates';
import { validJson } from '../lib/validate';
import { requireAdmin, requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';

const HOUR = 60 * 60 * 1000;
const tokenChecks = rateLimit('unsubscribe-token-checks', 30, HOUR / 4);
const testMailsPerUser = rateLimit('update-tests-per-user', 20, HOUR);
const sendsPerUser = rateLimit('update-sends-per-user', 5, HOUR);

const counts = (status: string) => sql<number>`count(*) filter (where ${updateDeliveries.status} = ${status})::int`;

async function summaries(c: Context<AppEnv>, id?: string): Promise<UpdateSummary[]> {
  const db = c.get('db');
  const deliveries = db
    .select({
      updateId: updateDeliveries.updateId,
      sent: counts('sent').as('sent'),
      failed: counts('failed').as('failed'),
      pending: counts('pending').as('pending'),
    })
    .from(updateDeliveries)
    .where(id ? eq(updateDeliveries.updateId, id) : undefined)
    .groupBy(updateDeliveries.updateId)
    .as('deliveries');
  const rows = await db
    .select({
      id: updates.id,
      slug: updates.slug,
      content: updates.content,
      hasImage: sql<boolean>`${updates.image} is not null`,
      createdAt: updates.createdAt,
      sentAt: updates.sentAt,
      sent: deliveries.sent,
      failed: deliveries.failed,
      pending: deliveries.pending,
    })
    .from(updates)
    .leftJoin(deliveries, eq(deliveries.updateId, updates.id))
    .where(id ? eq(updates.id, id) : undefined)
    .orderBy(desc(updates.createdAt));
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    sent: row.sent ?? 0,
    failed: row.failed ?? 0,
    pending: row.pending ?? 0,
  }));
}

// The update and the admin's own unsubscribe token, for previews and test mails
async function forAdmin(c: Context<AppEnv>) {
  const id = c.req.param('id')!;
  if (!UUID.test(id)) return null;
  const db = c.get('db');
  const [update] = await db
    .select({ id: updates.id, content: updates.content, image: updates.image, sentAt: updates.sentAt })
    .from(updates)
    .where(eq(updates.id, id));
  if (!update) return null;
  const [user] = await db
    .select({ email: users.email, token: users.unsubscribeToken })
    .from(users)
    .where(eq(users.id, c.get('user').id));
  return {
    update: { id, content: update.content, hasImage: !!update.image, date: update.sentAt ?? new Date() },
    user: user!,
  };
}

// Unsubscribing and subscribing again with the token from the mail, no login.
// The one-click POST from the mail client lands here as well.
async function setConsent(c: Context<AppEnv>, on: boolean) {
  const token = c.req.query('token') ?? '';
  const [recipient] = UUID.test(token)
    ? await c.get('db').select({ id: users.id }).from(users).where(eq(users.unsubscribeToken, token))
    : [];
  if (!(await tokenChecks.hit(c, recipient?.id ?? clientIp(c)))) return tooManyRequests(c);
  if (!recipient) return c.json({ error: t(c).unsubscribeInvalid }, 400);
  const [user] = await c
    .get('db')
    .update(users)
    .set({ updatesConsentAt: on ? sql`coalesce(${users.updatesConsentAt}, now())` : null, updatedAt: new Date() })
    .where(eq(users.id, recipient.id))
    .returning({ id: users.id });
  if (!user) return c.json({ error: t(c).unsubscribeInvalid }, 400);
  return c.json({ ok: true });
}

export const updateRoutes = new Hono<AppEnv>()
  .post('/unsubscribe', (c) => setConsent(c, false))
  .post('/subscribe', (c) => setConsent(c, true))

  // Linked from the mails, so without login. The random id is the key.
  .get('/:id/image', async (c) => {
    const id = c.req.param('id');
    const [row] = UUID.test(id)
      ? await c
          .get('db')
          .select({ image: updates.image, sentAt: updates.sentAt })
          .from(updates)
          .where(eq(updates.id, id))
      : [];
    if (!row?.image) return c.json({ error: t(c).notFound }, 404);
    // A draft's image may still change, the preview must not show an old one
    return c.body(new Uint8Array(row.image), 200, {
      'content-type': imageType(row.image)!,
      'cache-control': row.sentAt ? 'public, max-age=86400' : 'no-cache',
    });
  })

  // Only admins from ADMIN_EMAILS. admin@pleasance.org is not among them, so
  // agents write drafts as files and never send.
  .get('/', requireAuth, requireAdmin, async (c) => {
    const [subscribers] = await c
      .get('db')
      .select({ count: count() })
      .from(users)
      .where(isNotNull(users.updatesConsentAt));
    return c.json({ updates: await summaries(c), subscribers: subscribers!.count });
  })

  .post('/', requireAuth, requireAdmin, validJson(saveUpdateSchema), async (c) => {
    const { content, image } = c.req.valid('json');
    const bytes = image ? Buffer.from(image, 'base64') : null;
    if (bytes && !imageType(bytes)) return c.json({ error: t(c).invalidUpdateImage }, 400);
    const [row] = await c.get('db').insert(updates).values({ content, image: bytes }).returning({ id: updates.id });
    return c.json({ update: (await summaries(c, row!.id))[0] });
  })

  // Drafts only, a sent update stays as it went out
  .put('/:id', requireAuth, requireAdmin, validJson(saveUpdateSchema), async (c) => {
    const id = c.req.param('id');
    const { content, image } = c.req.valid('json');
    const bytes = image == null ? image : Buffer.from(image, 'base64');
    if (bytes && !imageType(bytes)) return c.json({ error: t(c).invalidUpdateImage }, 400);
    const [row] = UUID.test(id)
      ? await c
          .get('db')
          .update(updates)
          .set({ content, image: bytes, updatedAt: new Date() })
          .where(and(eq(updates.id, id), isNull(updates.sentAt)))
          .returning({ id: updates.id })
      : [];
    if (!row) return c.json({ error: t(c).updateAlreadySent }, 409);
    return c.json({ update: (await summaries(c, id))[0] });
  })

  .delete('/:id', requireAuth, requireAdmin, async (c) => {
    const id = c.req.param('id');
    const [row] = UUID.test(id)
      ? await c
          .get('db')
          .delete(updates)
          .where(and(eq(updates.id, id), isNull(updates.sentAt)))
          .returning({ id: updates.id })
      : [];
    if (!row) return c.json({ error: t(c).updateAlreadySent }, 409);
    return c.json({ ok: true });
  })

  // The mail as recipients see it, for the iframe on the admin page
  .get('/:id/preview', requireAuth, requireAdmin, async (c) => {
    const found = await forAdmin(c);
    if (!found) return c.json({ error: t(c).notFound }, 404);
    const locale: Locale = c.req.query('locale') === 'en' ? 'en' : 'de';
    const { html } = updateMail(found.update, locale, found.user.token);
    c.header('content-security-policy', "default-src 'none'; img-src * data:; style-src 'unsafe-inline'; font-src *");
    return c.html(html);
  })

  // Both languages to the admin, before and after sending
  .post('/:id/test', requireAuth, requireAdmin, async (c) => {
    if (!(await testMailsPerUser.hit(c, c.get('user').id))) return tooManyRequests(c);
    const found = await forAdmin(c);
    if (!found) return c.json({ error: t(c).notFound }, 404);
    try {
      for (const locale of ['de', 'en'] as const)
        await sendMail({ to: found.user.email, ...updateMail(found.update, locale, found.user.token) });
    } catch (err) {
      // Not to the global handler, SMTP errors may quote the address
      console.error(`[updates] Test mail of update ${found.update.id} failed: ${redact(err)}`);
      return c.json({ error: t(c).internalError }, 502);
    }
    return c.json({ ok: true });
  })

  // Queues one delivery per opted-in account, the worker sends them throttled
  // (worker.ts). Marking it sent first makes a double click harmless.
  .post('/:id/send', requireAuth, requireAdmin, async (c) => {
    if (!(await sendsPerUser.hit(c, c.get('user').id))) return tooManyRequests(c);
    const found = await forAdmin(c);
    if (!found) return c.json({ error: t(c).notFound }, 404);
    // Checked on the locked row, so a save from another tab can't slip in between
    const id = found.update.id;
    const error = await c.get('db').transaction(async (tx) => {
      const [row] = await tx
        .select({ content: updates.content, sentAt: updates.sentAt })
        .from(updates)
        .where(eq(updates.id, id))
        .for('update');
      if (!row || row.sentAt) return 'updateAlreadySent' as const;
      if (!updateComplete(row.content)) return 'updateIncomplete' as const;
      await tx.update(updates).set({ sentAt: new Date() }).where(eq(updates.id, id));
      await tx.execute(
        sql`insert into ${updateDeliveries} (update_id, user_id) select ${id}::uuid, id from ${users} where updates_consent_at is not null`,
      );
      return null;
    });
    if (error) return c.json({ error: t(c)[error] }, error === 'updateIncomplete' ? 400 : 409);
    return c.json({ update: (await summaries(c, id))[0] });
  });
