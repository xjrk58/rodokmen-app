import { ProposalList } from '@rodokmen/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { startBrowserWorld, type BrowserWorld } from './browser.js';
import { createMember, ensureOwner, signIn } from './helpers.js';

/**
 * Documents on Sources in the app (evidence-media spec, "Documents on Sources"): a Member attaches
 * a scanned family chronicle as a PDF to a Family account; a DOC is refused with a request for a
 * PDF. Once an Editor accepts, every Member opens the PDF from the Citation of the Source. In
 * Chromium at phone and desktop size, against the real server.
 */
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n% Invented family chronicle\n', 'latin1'), Buffer.alloc(1024, 0x20), Buffer.from('\n%%EOF\n')]);
const DOC = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(1024, 0)]);

describe('documents on Sources in the app (Chromium, phone and desktop)', () => {
  let w: BrowserWorld;
  let contributor: Account;
  let editor: Account;
  let other: Account;

  beforeAll(async () => {
    w = await startBrowserWorld();
    await ensureOwner(w.t.db);
    contributor = await createMember(w.t.db, 'contributor', { displayName: 'Karel Contributor', language: 'en' });
    other = await createMember(w.t.db, 'contributor', { displayName: 'Olga Other', language: 'en' });
    editor = await createMember(w.t.db, 'editor', { displayName: 'Eva Editor', language: 'en' });
  }, 60_000);
  afterAll(async () => w?.close());

  for (const size of ['phone', 'desktop'] as const) {
    it(`family chronicle and not a PDF (${size}): a DOC is refused, the PDF goes with the Proposal and opens from the Source once accepted`, async () => {
      const page = await w.open(contributor, size, '#work/propose/baptism');
      const form = page.getByTestId('propose-form');
      await form.waitFor();
      await page.getByTestId('child-given').fill(`Chronicled ${size}`);
      await page.getByTestId('child-surname').fill('Invented');
      await page.getByTestId('source-mode-account').check();
      await page.getByTestId('given-by').fill('Invented Aunt');
      await page.getByTestId('given-on').fill('1936');
      await page.getByTestId('source-title').fill(`Family chronicle (${size})`);
      await page.getByTestId('transcription').fill('Born in the invented village, as the chronicle says.');

      // Not a PDF: the app refuses the DOC and asks for a PDF.
      await page.getByTestId('document-input').setInputFiles({ name: 'chronicle.doc', mimeType: 'application/msword', buffer: DOC });
      await expect.poll(() => page.getByTestId('form-status').textContent()).toMatch(/Only PDF documents can be attached/);
      expect(await page.getByTestId('document').count()).toBe(0);
      await page.getByTestId('document-input').setInputFiles({ name: 'chronicle.pdf', mimeType: 'application/pdf', buffer: PDF });
      await expect.poll(() => page.getByTestId('document').allTextContents()).toEqual(['chronicle.pdf×']);
      await w.screenshot(page, `document-form-${size}`);

      await page.getByTestId('submit').click();
      await page.waitForURL(/#work\/mine\//, { timeout: 15_000 });

      const cookie = await signIn(w.t.db, w.clock, editor);
      const [pending] = ProposalList.parse((await w.app.inject({ method: 'GET', url: '/api/review', headers: { cookie } })).json()).items;
      expect(pending!.operations.map((o) => o.operation.op)).toContain('addDocument');
      const accepted = await w.app.inject({ method: 'POST', url: `/api/proposals/${pending!.id}/accept`, headers: { cookie, origin: w.origin }, payload: {} });
      expect(accepted.statusCode, accepted.body).toBe(200);
      const child = pending!.operations.find((o) => o.operation.op === 'createPerson')!;
      const personId = await w.t.db
        .selectFrom('name')
        .select('person_id')
        .where('given', '=', child.operation.op === 'createPerson' ? child.operation.name.given : '')
        .executeTakeFirstOrThrow();

      // Another Member opens it from the Citation of the Source.
      const reader = await w.open(other, size, `#people/${personId.person_id}`);
      await reader.getByTestId('citation').getByRole('button').first().click();
      const link = reader.getByTestId('citation-document');
      await expect.poll(() => link.textContent()).toBe('chronicle');
      expect(await link.getAttribute('href')).toMatch(/^\/api\/documents\/[0-9a-f-]{36}$/);
      await w.screenshot(reader, `document-citation-${size}`);
    });
  }
});
