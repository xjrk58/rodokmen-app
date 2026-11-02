import { ProposalList } from '@rodokmen/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import { startBrowserWorld, type BrowserWorld } from './browser.js';
import { createMember, ensureOwner, signIn } from './helpers.js';

/**
 * Research notes and Labels in the app (tree-model spec, "Research notes on records" and "Labels
 * on Persons"; tree-read-api spec, "Filter by Label"): a Contributor writes a note and a Label on
 * a person page's "Notes and Labels", without a Citation; once an Editor accepts, the person page
 * shows both, and People finds the Person by the Label. In Chromium at phone and desktop size,
 * against the real server.
 */
const L = generateFixture().landmarks;

describe('notes and Labels in the app (Chromium, phone and desktop)', () => {
  let w: BrowserWorld;
  let contributor: Account;
  let editor: Account;

  beforeAll(async () => {
    w = await startBrowserWorld();
    await ensureOwner(w.t.db);
    contributor = await createMember(w.t.db, 'contributor', { displayName: 'Karel Contributor', language: 'en' });
    editor = await createMember(w.t.db, 'editor', { displayName: 'Eva Editor', language: 'en' });
  }, 60_000);
  afterAll(async () => w?.close());

  const acceptAll = async () => {
    const cookie = await signIn(w.t.db, w.clock, editor);
    const pending = ProposalList.parse((await w.app.inject({ method: 'GET', url: '/api/review?limit=100', headers: { cookie } })).json()).items;
    for (const p of pending) {
      const res = await w.app.inject({ method: 'POST', url: `/api/proposals/${p.id}/accept`, headers: { cookie, origin: w.origin }, payload: {} });
      expect(res.statusCode, res.body).toBe(200);
    }
    return pending;
  };

  for (const size of ['phone', 'desktop'] as const) {
    it(`open question kept, and a family line (${size}): the note and the Label are shown on the person page, and People finds the Person by the Label`, async () => {
      const note = `baptism not found 1801–1803, check the neighbouring parish (${size})`;
      const label = `line/novak-${size}`;
      const page = await w.open(contributor, size, `#people/${L.janNovak}`);
      await page.getByTestId('edit-notes').click();
      const form = page.getByTestId('propose-form');
      await form.waitFor();
      // Notes and Labels state no fact: the form asks for no Citation.
      expect(await form.getByTestId('transcription').count()).toBe(0);
      await form.getByTestId('notes-text').fill(note);
      await form.getByTestId('label-input').fill(label);
      await form.getByTestId('label-add').click();
      await expect.poll(() => form.getByTestId('label-chip').allTextContents()).toContain(`${label}×`);
      await w.screenshot(page, `notes-form-${size}`);
      await form.getByTestId('submit').click();
      await page.waitForURL(/#work\/mine\//);

      const accepted = await acceptAll();
      expect(accepted).toHaveLength(1);
      expect(accepted[0]!.operations.map((o) => o.operation.op)).toEqual(['setNotes', 'addLabel']);

      await page.goto(`${w.origin}/#people/${L.janNovak}`);
      await expect.poll(() => page.getByTestId('person-notes').textContent()).toBe(note);
      expect(await page.getByTestId('person-label').allTextContents()).toContain(label);
      await w.screenshot(page, `person-notes-${size}`);

      await page.goto(`${w.origin}/#people`);
      await page.getByTestId('label-filter').fill(label.toUpperCase());
      await expect.poll(async () => page.getByTestId('person-result').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')))).toEqual([L.janNovak]);
      await w.screenshot(page, `people-by-label-${size}`);
    });
  }
});
