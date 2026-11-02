import { BatchView, OPERATIONS_VERSION } from '@rodokmen/shared';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { startBrowserWorld, type BrowserWorld } from './browser.js';
import { bearer, createAgentWithToken, createMember, ensureOwner } from './helpers.js';

/**
 * The batch view of the review queue (review spec, "Batch view in the review queue", "Accept a
 * whole Import batch"; vault-import spec, "Batch in the queue"; add-vault-import task 2.4): an
 * Import batch is one entry with its author, size and progress; the Owner opens it, spot-checks a
 * random sample of 20 pending Proposals, each shown in full, and accepts the whole batch after a
 * confirmation. In Chromium at phone (390 px) and desktop size, against the real server.
 */
describe('Import batches in the review queue (Chromium, phone and desktop)', () => {
  let w: BrowserWorld;
  let owner: Account;
  let editor: Account;
  let token: string;

  beforeAll(async () => {
    w = await startBrowserWorld();
    owner = await ensureOwner(w.t.db);
    await w.t.db.updateTable('account').set({ language: 'en' }).where('id', '=', owner.id).execute();
    editor = await createMember(w.t.db, 'editor', { displayName: 'Eva Editor', language: 'en' });
    ({ token } = await createAgentWithToken(w.t.db, w.clock, 'Vault importer'));
  }, 60_000);
  afterAll(async () => w?.close());

  /** An Import batch of `count` invented Place Proposals, submitted with the Agent's token. */
  async function importBatch(name: string, count: number): Promise<BatchView> {
    const agent = (url: string, payload: object) => w.app.inject({ method: 'POST', url, headers: bearer(token), payload });
    const batch = BatchView.parse((await agent('/api/batches', { name })).json());
    for (let i = 0; i < count; i++) {
      const tag = `${name.replace(/\W/g, '')}${i}`;
      const res = await agent(`/api/batches/${batch.id}/proposals`, {
        formatVersion: OPERATIONS_VERSION,
        idempotencyKey: `e2e-${randomUUID()}`,
        note: `places/${tag}.md`,
        operations: [
          {
            op: 'createSource',
            tempId: 'tmp:s',
            type: 'family_account',
            title: 'Vault (invented)',
            familyAccount: { givenBy: 'Owner Example', givenByPersonId: null, givenOn: '2026-10-29' },
          },
          {
            op: 'createCitation',
            tempId: 'tmp:c',
            sourceId: 'tmp:s',
            page: `places/${tag}.md`,
            transcription: 'Place note of the invented Vault.',
            readOn: '2026-11-02',
            confidence: 'low',
          },
          { op: 'createPlace', tempId: 'tmp:place', type: 'hamlet', name: { name: `Invented Hamlet ${i + 1}`, language: 'cs' } },
        ],
      });
      expect(res.statusCode, res.body).toBe(201);
    }
    return batch;
  }

  for (const size of ['phone', 'desktop'] as const) {
    it(`spot-checking and accepting a batch (${size}): one entry in the queue; a sample of 20 pending Proposals, each in full; the whole batch after a confirmation`, async () => {
      const batch = await importBatch(`Vault import ${size}`, 30);
      const page = await w.open(owner, size, '#work/review');
      const entry = page.locator(`[data-testid="batch"][data-id="${batch.id}"]`);
      await entry.waitFor();
      expect(await entry.locator('.author').textContent()).toBe('Vault importerAgent');
      expect(await entry.getByTestId('batch-progress').textContent()).toBe('0 accepted · 30 pending · 0 blocked · 0 rejected');
      // The batch's Proposals are not each in the queue.
      expect(await page.locator('[data-testid="proposal"]').count()).toBe(0);
      await w.screenshot(page, `batch-queue-${size}`);

      await entry.getByTestId('open-batch').click();
      await page.getByTestId('batch-title').waitFor();
      await expect.poll(() => page.getByTestId('batch-shown').textContent()).toBe('Proposals 1–20 in batch order');
      expect(await page.getByTestId('batch-position').allTextContents()).toEqual([...Array(20).keys()].map((i) => `No. ${i + 1}`));

      await page.getByTestId('batch-sample').click();
      await expect.poll(() => page.getByTestId('batch-shown').textContent()).toBe('20 pending Proposals chosen at random');
      const cards = page.locator('[data-testid="proposal"]');
      expect(await cards.count()).toBe(20);
      const ids = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
      expect(new Set(ids).size).toBe(20);
      // Each in full: its changes, its Citation, and the Editor's actions.
      for (const card of await cards.all()) {
        expect(await card.getByTestId('changes').locator('li').count()).toBe(3);
        expect(await card.getByTestId('citation').count()).toBe(1);
        expect(await card.getByTestId('accept').isVisible()).toBe(true);
      }
      await w.screenshot(page, `batch-sample-${size}`);

      await page.getByTestId('accept-batch').click();
      expect(await page.getByTestId('batch-confirm').textContent()).toMatch(/^Accept all 30 pending Proposals of this batch, with 90 changes to records\?/);
      await page.getByTestId('confirm-accept-batch').click();
      await expect
        .poll(() => page.getByTestId('batch-result').locator('p').first().textContent(), { timeout: 30_000 })
        .toBe('Accepted 30. Still pending: 0 that could not be accepted, 0 that build on them.');
      await expect.poll(() => page.getByTestId('batch-progress').textContent()).toBe('30 accepted · 0 pending · 0 blocked · 0 rejected');
      await w.screenshot(page, `batch-accepted-${size}`);
    });
  }

  it('an Editor sees the batch and its Proposals, but no "Accept the whole batch"', async () => {
    const batch = await importBatch('Editor batch', 3);
    const page = await w.open(editor, 'desktop', `#work/review/batch/${batch.id}`);
    await page.getByTestId('batch-title').waitFor();
    await expect.poll(() => page.locator('[data-testid="proposal"]').count()).toBe(3);
    expect(await page.getByTestId('accept-batch').count()).toBe(0);
  });
});
