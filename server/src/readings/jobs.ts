import { imagesToSend, ReadingContext, ReadingCrop, ReadingResult, type ImageToSend } from '@rodokmen/shared';
import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';
import type { Reading } from '../db/types.js';
import { messageOf } from '../errors.js';
import type { ImageStorage } from '../storage/images.js';
import { cropForReading } from '../storage/process.js';
import { SerialQueue } from '../storage/serial-queue.js';
import { readingContextText } from './context.js';
import type { Reader, ReaderImage } from './reader.js';
import { scanSettings } from './settings.js';

/**
 * The reading queue (scan-reading spec; add-scan-reading task 1.3): readings run one at a time
 * in the server process, in the order they were asked for, so the 4 GB server never decodes two
 * scans at once and the API is called one reading after another. The state lives in the
 * `reading` table: a restart puts readings that were running back in the queue (`resume`).
 *
 * A job asks the switch again when it starts (imagesToSend in shared/src/reading.ts, proved):
 * a reading queued before the Owner switched reading off sends nothing and fails.
 */
export interface ReadingJobDeps {
  db: Db;
  clock: Clock;
  images: ImageStorage;
  reader: Reader | null;
  log?: (msg: string, error?: unknown) => void;
}

/** A reading running longer than this was left by a stopped process (one reading takes a few minutes at most). */
export const STALE_MS = 15 * 60_000;

export class ReadingJobs {
  private readonly queue = new SerialQueue();
  private closed = false;

  constructor(private readonly deps: ReadingJobDeps) {}

  /** Queues a reading that is in the table with status `queued`. */
  enqueue(id: string): void {
    if (this.closed) return;
    this.queue.run(() => this.process(id)).catch((e: unknown) => this.deps.log?.('a reading job failed', e));
  }

  /**
   * After a start: readings a stopped process left running go back to the queue, and every
   * queued one is queued here too, oldest first. During a deploy the previous release still
   * runs its own readings, so only those running for longer than STALE_MS count as left; a
   * queued reading is claimed by one process only.
   */
  async resume(): Promise<number> {
    const stale = new Date(this.deps.clock.now().getTime() - STALE_MS);
    await this.deps.db
      .updateTable('reading')
      .set({ status: 'queued', started_at: null })
      .where('status', '=', 'running')
      .where('started_at', '<', stale)
      .execute();
    const rows = await this.deps.db.selectFrom('reading').select('id').where('status', '=', 'queued').orderBy('created_at').orderBy('id').execute();
    for (const r of rows) this.enqueue(r.id);
    return rows.length;
  }

  /** Resolves when every queued reading has run (tests, and shutdown). */
  async idle(): Promise<void> {
    while (this.queue.size > 0) await this.queue.run(async () => undefined);
  }

  /** Stops taking readings; those queued stay `queued` in the table for the next start. */
  close(): void {
    this.closed = true;
  }

  private async fail(id: string, code: string, message: string, extra: Partial<Pick<Reading, 'model'>> & { usage?: object | null } = {}) {
    await this.deps.db
      .updateTable('reading')
      .set({
        status: 'failed',
        error_code: code,
        error_message: message,
        finished_at: this.deps.clock.now(),
        ...(extra.model !== undefined ? { model: extra.model } : {}),
        ...(extra.usage ? { usage: JSON.stringify(extra.usage) } : {}),
      })
      .where('id', '=', id)
      .execute();
  }

  /** The bytes of one image to send: its display copy, or its marked crop of the checked original. */
  private async imageOf(send: ImageToSend, crops: ReadingCrop[]): Promise<ReaderImage | null> {
    const { db, images } = this.deps;
    const u = await db.selectFrom('upload').selectAll().where('id', '=', send.uploadId).where('status', '=', 'ready').executeTakeFirst();
    if (!u) return null;
    // An accepted image lives under images/; its record has the keys.
    const image = u.image_id ? await db.selectFrom('image').select(['storage_key', 'display_key']).where('id', '=', u.image_id).executeTakeFirst() : undefined;
    const original = image?.storage_key ?? u.storage_key;
    const display = image?.display_key ?? u.display_key;
    if (send.copy === 'crop') {
      const crop = crops.find((c) => c.uploadId === send.uploadId);
      if (!crop) return null;
      const data = await cropForReading(() => images.get(original), crop);
      return data ? { data, mediaType: 'image/webp' } : null;
    }
    const data = await images.get(display);
    return data ? { data, mediaType: 'image/webp' } : null;
  }

  private async process(id: string): Promise<void> {
    const { db, clock, reader } = this.deps;
    const claimed = await db
      .updateTable('reading')
      .set({ status: 'running', started_at: clock.now() })
      .where('id', '=', id)
      .where('status', '=', 'queued')
      .returningAll()
      .executeTakeFirst();
    if (!claimed) return;
    try {
      const settings = await scanSettings(db);
      const crops = ReadingCrop.array().parse(claimed.crops);
      const context = ReadingContext.parse(claimed.context);
      const requested = claimed.upload_ids.map((uploadId) => ({ uploadId, crop: crops.some((c) => c.uploadId === uploadId) }));
      const plan = imagesToSend(settings.enabled && reader !== null, requested);
      if (plan.length === 0 || !reader) {
        await this.fail(id, 'switched_off', 'Scan reading was switched off before this reading started; nothing was sent.');
        return;
      }
      const sent: ReaderImage[] = [];
      for (const send of plan) {
        const image = await this.imageOf(send, crops);
        if (!image) {
          await this.fail(id, 'image_missing', 'A scan of this reading is no longer there. Upload it again.');
          return;
        }
        sent.push(image);
      }
      const answer = await reader.read({ images: sent, context: await readingContextText(db, clock, context) });
      if (answer.kind === 'failed') {
        await this.fail(id, answer.code, answer.message, { model: answer.model, usage: answer.usage });
        return;
      }
      // Checked against the contract; anything else is a failed reading, never repaired.
      const checked = ReadingResult.safeParse(answer.json);
      if (!checked.success) {
        const issues = checked.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`);
        await this.fail(
          id,
          'invalid_result',
          `The reading did not match what a reading must contain (${issues.join('; ')}). Try again, or fill in the form by hand.`,
          {
            model: answer.model,
            usage: answer.usage,
          },
        );
        return;
      }
      if (checked.data.pages.length !== plan.length) {
        await this.fail(id, 'invalid_result', `The reading has ${checked.data.pages.length} pages for ${plan.length} scans. Try again.`, {
          model: answer.model,
          usage: answer.usage,
        });
        return;
      }
      await db
        .updateTable('reading')
        .set({ status: 'done', result: JSON.stringify(checked.data), model: answer.model, usage: JSON.stringify(answer.usage), finished_at: clock.now() })
        .where('id', '=', id)
        .execute();
    } catch (error) {
      this.deps.log?.('a reading failed', error);
      await this.fail(id, 'internal', `The reading failed on the server (${messageOf(error)}).`).catch(() => undefined);
    }
  }
}
