// Research leads in the app (add-research-leads task 3.1; research-leads spec): the place sheet
// of a village with its open leads, the Leads list with its filters and the suggested leads, the
// leads on a person page, writing a lead, recording a search and closing a lead as not found, and
// "Start from this lead" into the Proposal forms. Against the mocked API and the invented Tree, at
// both viewports (the phone one is 390 px wide).
import { member, mockFamilyApi } from './family-api.js';
import { ID, P, PLACE, summary } from './family-data.js';
import { expect, test } from './fixtures.js';

/** @typedef {import('../../src/types.js').LeadDetail} LeadDetail */
/** @typedef {import('../../src/types.js').LeadSuggestion} LeadSuggestion */

const ME = member('contributor', { person: 10 });
const REGISTER = { id: ID(501), title: 'Invented register N 1784–1830', repository: 'Invented archive', reference: null };
const AUTHOR = { id: ID(901), displayName: 'Karel Contributor', isAgent: false };

/**
 * A lead of the invented Tree.
 * @param {number} n
 * @param {string} question
 * @param {Partial<LeadDetail>} [extra]
 * @returns {LeadDetail}
 */
function lead(n, question, extra = {}) {
  return {
    id: ID(n),
    version: 1,
    question,
    reason: 'Born about 1801; no baptism is cited yet.',
    archive: null,
    source: REGISTER,
    years: { from: 1798, to: 1804 },
    pages: null,
    status: 'open',
    outcome: null,
    persons: [summary(10)],
    places: [{ id: PLACE.kamennaLhota, version: 1, name: 'Kamenná Lhota', location: { lat: 49.6, lon: 15.9 } }],
    assignee: null,
    author: AUTHOR,
    foundBy: null,
    fromSuggestion: null,
    searches: [],
    createdAt: '2026-10-30T10:00:00.000Z',
    updatedAt: '2026-10-30T10:00:00.000Z',
    history: [{ at: '2026-10-30T10:00:00.000Z', author: AUTHOR, kind: 'created', proposalId: null, fields: [] }],
    ...extra,
  };
}

const BAPTISM = lead(800, 'Find Jan’s baptism');
const HOUSE = lead(801, 'Which house did Tomáš live in?', { source: null, archive: 'Invented archive', status: 'in_progress', years: null });
/** @param {LeadDetail[]} items */
const leadList = (items) => ({ items, total: items.length, limit: 50, offset: 0 });

/** @type {LeadSuggestion} */
const SUGGESTION = {
  id: ID(850),
  key: `parents:${P.jan}:${REGISTER.id}`,
  kind: 'parents',
  status: 'open',
  person: summary(10),
  familyId: null,
  partners: [],
  place: null,
  source: REGISTER,
  archive: 'Invented archive',
  years: { from: 1800, to: 1802 },
  question: { cs: 'Najít rodiče: Jan Novák', en: 'Find the parents of Jan Novák: check "Invented register N 1784–1830", years 1800–1802' },
  reason: { cs: 'Rodiče nejsou známí.', en: 'The parents are unknown, while the Parish and years of the birth are known.' },
  leadId: null,
};

test('village sheet: the place sheet of a village with two open leads lists both, with their questions and status', async ({ page }) => {
  const calls = await mockFamilyApi(page, {
    me: ME,
    extra: { 'GET leads': (_m, url) => ({ json: url.searchParams.get('placeId') === PLACE.kamennaLhota ? leadList([BAPTISM, HOUSE]) : leadList([]) }) },
  });
  await page.goto('./#map=16/49.6/15.9');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.getByTitle(/^Kamenná Lhota:/).click();
  const sheet = page.locator('#place-sheet');
  const leads = sheet.getByTestId('place-lead');
  await expect(leads).toHaveCount(2);
  await expect(leads.nth(0)).toContainText('Find Jan’s baptism');
  await expect(leads.nth(0).getByTestId('lead-status')).toHaveText('Open');
  await expect(leads.nth(1)).toContainText('Which house did Tomáš live in?');
  await expect(leads.nth(1).getByTestId('lead-status')).toHaveText('In progress');
  expect(calls).toContain(`GET leads?placeId=${PLACE.kamennaLhota}&status=open%2Cin_progress&limit=20`);
  // On a phone the sheet fits the screen: nothing sticks out sideways.
  expect(await sheet.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect(sheet.getByTestId('place-leads-all')).toHaveAttribute('href', `#leads/place/${PLACE.kamennaLhota}`);
  await leads.nth(0).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`#leads/${BAPTISM.id}$`));
});

test('the Leads list filters by status, archive, who is working on it and Place, and shows the suggested leads apart', async ({ page }) => {
  const calls = await mockFamilyApi(page, {
    me: ME,
    extra: {
      'GET leads': () => ({ json: leadList([BAPTISM, HOUSE]) }),
      'GET lead-suggestions': () => ({ json: { items: [SUGGESTION], total: 1, limit: 20, offset: 0 } }),
      [`POST lead-suggestions/${SUGGESTION.id}/dismiss`]: () => ({ json: { ...SUGGESTION, status: 'dismissed' } }),
    },
  });
  await page.goto('./#leads');
  await expect(page.getByTestId('tabbar-leads')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('lead')).toHaveCount(2);
  expect(calls).toContain('GET leads?status=open%2Cin_progress&limit=50');
  await page.getByTestId('filter-status').selectOption('not_found');
  await expect.poll(() => calls.some((c) => c.startsWith('GET leads?status=not_found&'))).toBe(true);
  await page.getByTestId('filter-archive').fill('invented');
  await expect.poll(() => calls.some((c) => c.includes('archive=invented'))).toBe(true);
  await page.getByTestId('filter-assignee').selectOption(ME.id);
  await expect.poll(() => calls.some((c) => c.includes(`assigneeId=${ME.id}`))).toBe(true);

  // Suggested leads are apart from the leads; a dismissed one goes.
  const suggestion = page.getByTestId('suggestion');
  await expect(suggestion).toContainText('Find the parents of Jan Novák');
  await suggestion.getByTestId('suggestion-dismiss').click();
  await expect.poll(() => calls).toContain(`POST lead-suggestions/${SUGGESTION.id}/dismiss`);

  await page.goto(`./#leads/place/${PLACE.kamennaLhota}`);
  await expect(page.getByTestId('filter-place')).toContainText('Kamenná Lhota');
  await expect.poll(() => calls.some((c) => c.includes(`placeId=${PLACE.kamennaLhota}`))).toBe(true);
});

test('a person page lists the Person’s leads and suggested leads, and a lead is written from there', async ({ page }) => {
  /** @type {unknown} */
  let written = null;
  await mockFamilyApi(page, {
    me: ME,
    extra: {
      'GET leads': (_m, url) => ({ json: leadList(url.searchParams.get('personId') === P.jan ? [BAPTISM] : []) }),
      'GET lead-suggestions': () => ({ json: { items: [SUGGESTION], total: 1, limit: 20, offset: 0 } }),
      'POST leads': (_m, _url, body) => {
        written = body;
        return { status: 201, json: lead(802, 'Find the godparents') };
      },
      [`GET leads/${ID(802)}`]: () => ({ json: lead(802, 'Find the godparents') }),
    },
  });
  await page.goto(`./#people/${P.jan}`);
  const section = page.getByTestId('person-leads');
  await expect(section.getByTestId('lead')).toHaveCount(1);
  await expect(section.getByTestId('lead-question')).toHaveText('Find Jan’s baptism');
  await expect(section.getByTestId('suggestion')).toHaveCount(1);
  await section.getByTestId('person-write-lead').click();
  await expect(page.getByTestId('lead-for-person')).toBeVisible();
  await page.getByTestId('new-lead-submit').click();
  await expect(page.getByTestId('new-lead-status')).toHaveText('Write the question and why.');
  await page.getByTestId('lead-question-input').fill('Find the godparents');
  await page.getByTestId('lead-reason-input').fill('Not named in the transcription.');
  await page.getByTestId('lead-from-input').fill('1801');
  await page.getByTestId('lead-to-input').fill('1801');
  await page.getByTestId('new-lead-submit').click();
  await expect(page.getByTestId('lead-title')).toHaveText('Find the godparents');
  expect(written).toMatchObject({ question: 'Find the godparents', personIds: [P.jan], placeIds: [], years: { from: 1801, to: 1801 } });
});

test('negative result: a search is recorded and the lead closed as not found, and the lead shows that search', async ({ page }) => {
  /** @type {unknown} */
  let closed = null;
  const search = {
    id: ID(870),
    source: REGISTER,
    archive: null,
    years: { from: 1798, to: 1805 },
    pages: '1–60',
    searchedOn: '2026-10-30',
    searchedBy: 'Eliška Invented',
    found: false,
    note: null,
    author: AUTHOR,
    createdAt: '2026-10-30T11:00:00.000Z',
  };
  await mockFamilyApi(page, {
    me: ME,
    extra: {
      [`GET leads/${BAPTISM.id}`]: () => ({ json: BAPTISM }),
      [`POST leads/${BAPTISM.id}/close`]: (_m, _url, body) => {
        closed = body;
        return { json: { ...BAPTISM, version: 2, status: 'not_found', searches: [search] } };
      },
    },
  });
  await page.goto(`./#leads/${BAPTISM.id}`);
  await expect(page.getByTestId('lead-where')).toContainText('Invented register N 1784–1830 · 1798–1804');
  await expect(page.getByTestId('no-searches')).toBeVisible();
  await page.getByTestId('search-to').fill('1805');
  await page.getByTestId('search-pages').fill('1–60');
  await page.getByTestId('search-close-not-found').click();
  await expect(page.getByTestId('lead-status').first()).toHaveText('Not found');
  expect(closed).toEqual({
    baseVersion: 1,
    status: 'not_found',
    search: { sourceId: REGISTER.id, archive: null, years: { from: 1798, to: 1805 }, pages: '1–60', found: false, note: null },
  });
  const record = page.getByTestId('search-record');
  await expect(record).toContainText('Invented register N 1784–1830 · 1798–1805 · pages 1–60');
  await expect(record.getByTestId('search-result')).toHaveText('nothing found');
  // A closed lead is not searched or proposed from again; it can be reopened.
  await expect(page.getByTestId('search-form')).toHaveCount(0);
  await expect(page.getByTestId('lead-reopen')).toBeVisible();
});

test('start from this lead: the baptism form starts from the lead’s Person, Place and register, and the Proposal names the lead it answers', async ({
  page,
}) => {
  const sent = /** @type {{ body: import('../../src/types.js').SubmitProposalBody | null }} */ ({ body: null });
  await mockFamilyApi(page, {
    me: ME,
    extra: {
      [`GET leads/${BAPTISM.id}`]: () => ({ json: BAPTISM }),
      'POST proposals': (_m, _url, body) => {
        sent.body = /** @type {import('../../src/types.js').SubmitProposalBody} */ (body);
        return { status: 201, json: { id: ID(400) } };
      },
      'GET proposals': () => ({ json: { items: [] } }),
    },
  });
  await page.goto(`./#leads/${BAPTISM.id}`);
  await page.getByTestId('start-from-lead').getByTestId('start-baptism').click();
  await expect(page.getByTestId('answers-lead')).toHaveText('This finding answers the lead: Find Jan’s baptism');
  await expect(page.getByTestId('child')).toContainText('Jan Novák');
  await expect(page.getByTestId('place')).toContainText('Kamenná Lhota');
  await expect(page.getByTestId('source')).toContainText('Invented register N 1784–1830');
  await page.getByTestId('date').fill('1801-03-12');
  await page.getByTestId('transcription').fill('Joannes, filius legitimus');
  await page.getByTestId('submit').click();
  await expect.poll(() => sent.body?.answersLeads).toEqual([BAPTISM.id]);
  const operations = sent.body?.operations ?? [];
  expect(operations).toContainEqual(expect.objectContaining({ op: 'addRole', personId: P.jan, role: 'child' }));
});
