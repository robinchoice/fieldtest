import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { type Database, updateDeliveries, updates, users } from '@app/db';
import { type Locale, type UpdateContent, updateComplete } from '@app/shared';
import { and, asc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { imageType } from './image';
import { sendMail, updateMail } from './mail';

// Agents write drafts as updates/<slug>.md in the repo, Robin sends them in
// /admin/updates (README, „Update-Mails“). Format:
//
//   # de: Die Karte zeigt jetzt Sprachfamilien
//   - Auf der Karte färben sich Sprachen nach ihrer Familie.
//   ![](karte.png)
//
//   # en: The map now shows language families
//   - Languages on the map are coloured by family.
export const DRAFTS_DIR = path.join(import.meta.dir, '../../../../updates');

export type Draft = { slug: string; content: UpdateContent; image: Buffer | null };

export function parseDraft(slug: string, text: string, dir = DRAFTS_DIR): Draft {
  const content: Partial<UpdateContent> = {};
  let current: Locale | null = null;
  let image: Buffer | null = null;
  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    const heading = line.match(/^#\s*(de|en)\s*:\s*(.+)$/);
    const item = line.match(/^[-*]\s+(.+)$/);
    const picture = line.match(/^!\[[^\]]*\]\(([^)]+)\)$/);
    if (!line) continue;
    if (heading) {
      current = heading[1] as Locale;
      content[current] = { title: heading[2]!.trim(), features: [] };
    } else if (item && current) {
      content[current]!.features.push(item[1]!.trim());
    } else if (picture) {
      image = readFileSync(path.join(dir, picture[1]!));
      if (!imageType(image)) throw new Error(`updates/${slug}.md: ${picture[1]} is no PNG or JPEG`);
    } else {
      throw new Error(`updates/${slug}.md, line ${index + 1}: expected "# de: Title", "- Feature" or "![](image.png)"`);
    }
  }
  if (!content.de || !content.en || !updateComplete(content as UpdateContent))
    throw new Error(`updates/${slug}.md needs a title and at least one feature for de and en`);
  return { slug, content: content as UpdateContent, image };
}

export function readDrafts(dir = DRAFTS_DIR, onError?: (error: unknown) => void) {
  const drafts: Draft[] = [];
  for (const file of readdirSync(dir).filter((file) => file.endsWith('.md'))) {
    try {
      drafts.push(parseDraft(file.slice(0, -3), readFileSync(path.join(dir, file), 'utf8'), dir));
    } catch (err) {
      if (!onError) throw err;
      onError(err);
    }
  }
  return drafts;
}

// On every API start. A file becomes a draft once and is never overwritten, so
// edits in the admin page stay. A broken file only costs its own draft, the
// API test parses all of them before a deploy.
export async function importDrafts(db: Database) {
  let drafts: Draft[];
  try {
    drafts = readDrafts(DRAFTS_DIR, (err) => console.error('[updates] Draft not imported:', err));
  } catch (err) {
    console.error('[updates] Drafts not imported:', err);
    return;
  }
  for (const draft of drafts) await db.insert(updates).values(draft).onConflictDoNothing();
}

const MAX_ATTEMPTS = 3;
// A failed delivery waits this long, the SMTP server may be over its limit
const RETRY_MS = 60_000;

const smtpError = z.object({
  responseCode: z.number().exactOptional(),
  code: z.string().exactOptional(),
  message: z.string().exactOptional(),
});

// SMTP errors may quote the recipient, the log gets neither address nor name
export function redact(err: unknown) {
  const { responseCode, code, message } = smtpError.safeParse(err).data ?? {};
  const text = String(message ?? err).replace(/[^\s<>"'@]+@[^\s<>"'@]+/g, '<address>');
  return [responseCode ?? code, text].filter(Boolean).join(' ');
}

// Sends the oldest due delivery, at most one per intervalMs across all
// workers: an advisory lock lets one worker at a time in, and the last attempt
// of any worker sets the pace. The row stays locked until it is marked, so no
// mail goes out twice. 'wait' means another worker or the pace holds it back.
export function deliverNext(
  db: Database,
  intervalMs: number,
  send: typeof sendMail = sendMail,
): Promise<'idle' | 'wait' | 'sent' | 'skipped' | 'failed'> {
  return db.transaction(async (tx) => {
    const [lock] = await tx.execute<{ ok: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext('update-mails')) as ok`,
    );
    if (!lock?.ok) return 'wait';
    const [recent] = await tx
      .select({ id: updateDeliveries.id })
      .from(updateDeliveries)
      .where(gt(updateDeliveries.attemptedAt, sql`now() - make_interval(secs => ${intervalMs / 1000})`))
      .limit(1);
    if (recent) return 'wait';

    const [row] = await tx
      .select({
        id: updateDeliveries.id,
        attempts: updateDeliveries.attempts,
        updateId: updates.id,
        content: updates.content,
        hasImage: sql<boolean>`${updates.image} is not null`,
        sentAt: updates.sentAt,
        email: users.email,
        locale: users.locale,
        consent: users.updatesConsentAt,
        token: users.unsubscribeToken,
      })
      .from(updateDeliveries)
      .innerJoin(updates, eq(updates.id, updateDeliveries.updateId))
      .innerJoin(users, eq(users.id, updateDeliveries.userId))
      .where(
        and(
          eq(updateDeliveries.status, 'pending'),
          or(
            isNull(updateDeliveries.attemptedAt),
            lt(updateDeliveries.attemptedAt, sql`now() - make_interval(secs => ${RETRY_MS / 1000})`),
          ),
        ),
      )
      .orderBy(asc(updateDeliveries.createdAt))
      .limit(1)
      .for('update', { of: updateDeliveries, skipLocked: true });
    if (!row) return 'idle';

    const mark = (status: string) =>
      tx
        .update(updateDeliveries)
        .set({ status, attempts: row.attempts + 1, attemptedAt: sql`now()` })
        .where(eq(updateDeliveries.id, row.id));

    // Unsubscribed since Robin pressed send
    if (!row.consent) {
      await tx.update(updateDeliveries).set({ status: 'skipped' }).where(eq(updateDeliveries.id, row.id));
      return 'skipped';
    }

    const locale: Locale = row.locale === 'en' ? 'en' : 'de';
    const mail = updateMail(
      { id: row.updateId, content: row.content, hasImage: row.hasImage, date: row.sentAt! },
      locale,
      row.token,
    );
    try {
      await send({ to: row.email, ...mail });
    } catch (err) {
      console.error(
        `[updates] Delivery ${row.id} of update ${row.updateId} failed, attempt ${row.attempts + 1}: ${redact(err)}`,
      );
      await mark(row.attempts + 1 >= MAX_ATTEMPTS ? 'failed' : 'pending');
      return 'failed';
    }
    await mark('sent');
    return 'sent';
  });
}
