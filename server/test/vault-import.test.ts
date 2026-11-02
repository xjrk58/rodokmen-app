import {
  BatchList,
  CitationDetail,
  EventDetail,
  LeadDetail,
  LeadList,
  PersonDetail,
  PersonSearchResult,
  PlaceDetail,
  ProposalList,
  SourceDetail,
  SourceSearchResult,
} from '@rodokmen/shared';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import type { Municipality } from '../src/vault-import/map-places.js';
import { readVault } from '../src/vault-import/reader.js';
import { runImport, type ImportOptions, type ImportResult } from '../src/vault-import/run.js';
import { bearer, createAgentWithToken, ensureOwner, signIn } from './helpers.js';
import { startLiveServer, type LiveServer } from './live-server.js';

/**
 * The Vault importer (vault-import spec; add-vault-import tasks 3.1–3.6) against the real server,
 * on the invented fixture Vault in test/fixtures/vault. DOC files are "converted" by a stand-in
 * here; vault-import-soffice.test.ts converts with LibreOffice where it is installed.
 */
const FIXTURE = new URL('./fixtures/vault/', import.meta.url).pathname;
const MUNICIPALITIES: Municipality[] = [{ code: '572128', name: 'Vrbice', district: 'Jičín', lat: 50.38, lon: 15.39 }];
const PDF = Buffer.from('%PDF-1.4\n% converted from the invented DOC\n%%EOF\n');

describe('the Vault importer', () => {
  let s: LiveServer;
  let token: string;
  let owner: Account;
  let vault: string;
  let dry: ImportResult;
  let first: ImportResult;

  const options = (over: Partial<ImportOptions> = {}): ImportOptions => ({
    vault,
    url: s.origin,
    token,
    dryRun: false,
    givenBy: 'Owner Example',
    roots: [],
    municipalities: MUNICIPALITIES,
    today: new Date('2026-11-02T12:00:00Z'),
    convert: async (_doc, dir) => {
      const out = join(dir, 'converted.pdf');
      await writeFile(out, PDF);
      return out;
    },
    ...over,
  });
  const asOwner = async (method: 'GET' | 'POST', url: string, payload?: object) =>
    s.app.inject({ method, url, headers: { cookie: await signIn(s.t.db, s.clock, owner), origin: s.origin }, ...(payload ? { payload } : {}) });
  const get = async <T>(url: string, schema: { parse(v: unknown): T }) => schema.parse((await asOwner('GET', url)).json());
  const counts = async () => {
    const n = async (table: 'person' | 'proposal' | 'upload' | 'place' | 'event' | 'import_batch' | 'lead') =>
      (
        await s.t.db
          .selectFrom(table)
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .executeTakeFirstOrThrow()
      ).n;
    return {
      persons: await n('person'),
      proposals: await n('proposal'),
      uploads: await n('upload'),
      places: await n('place'),
      events: await n('event'),
      batches: await n('import_batch'),
      leads: await n('lead'),
    };
  };
  /** The record the importer created for a Vault key, through its id map. */
  const recordOf = async (key: string) =>
    (
      await s.t.db
        .selectFrom('vault_import_map as m')
        .innerJoin('proposal_temp as t', (j) => j.onRef('t.proposal_id', '=', 'm.proposal_id').onRef('t.temp_id', '=', 'm.temp_id'))
        .select('t.record_id')
        .where('m.key', '=', key)
        .executeTakeFirstOrThrow()
    ).record_id;
  const personByVault = async (key: string) => get(`/api/persons/${await recordOf(key)}`, PersonDetail);

  beforeAll(async () => {
    s = await startLiveServer();
    owner = await ensureOwner(s.t.db);
    ({ token } = await createAgentWithToken(s.t.db, s.clock, 'Vault importer'));
    // A copy, so that the second-run test can add a note.
    vault = await mkdtemp(join(tmpdir(), 'rodokmen-vault-'));
    await cp(FIXTURE, vault, { recursive: true });
  }, 60_000);
  afterAll(async () => {
    await s?.close();
    if (vault) await rm(vault, { recursive: true, force: true });
  });

  it('reads the Vault format: unknown folders are skipped and listed, every note is read', async () => {
    const v = await readVault(vault);
    expect(v.issues).toContainEqual({ kind: 'skippedFolder', path: 'data/', detail: 'not a folder of the Vault format; not imported' });
    expect(v.notes.map((n) => n.folder).sort()).toEqual(
      [
        'houses',
        'log',
        'parishes',
        'people',
        'people',
        'people',
        'people',
        'people',
        'places',
        'places',
        'plans',
        'registers',
        'registers',
        'sources',
        'sources',
        'sources',
      ].sort(),
    );
  });

  it('nothing submitted: the dry run creates no Proposal, upload or Tree record, and reports what it would do', async () => {
    const before = await counts();
    dry = await runImport(options({ dryRun: true }));
    expect(await counts()).toEqual(before);
    expect(dry.run.submitted).toBe(dry.plan.proposals.length);
    expect(dry.counts.records).toMatchObject({ person: 5, place: 2, parish: 1, house: 1, source: 4, image: 2, document: 2, event: 8, family: 2 });
    expect(dry.counts.proposals).toEqual({ vault: 1, place: 2, parish: 1, house: 1, register: 2, source: 3, person: 4 });
    expect(dry.report).toContain('A dry run: nothing was submitted, uploaded or created.');
  });

  it('broken link: the dry run lists the note and the missing id', () => {
    expect(dry.plan.issues).toContainEqual({ kind: 'brokenLink', path: 'people/tomas-novak-1770.md', detail: 'father: [[josef-novak-1770]]' });
    expect(dry.report).toContain('people/tomas-novak-1770.md: father: [[josef-novak-1770]]');
  });

  it('lists every field it cannot map, every date that is not EDTF, and every file it cannot read', () => {
    const issues = dry.plan.issues;
    expect(issues).toContainEqual({ kind: 'unmappedField', path: 'people/jan-novak-1801.md', detail: 'people.occupation' });
    expect(issues).toContainEqual({ kind: 'unmappedField', path: 'parishes/vrbice.md', detail: 'parishes.denomination' });
    expect(issues).toContainEqual({ kind: 'unmappedValue', path: 'places/kamenna-lhota.md', detail: 'places.names.en' });
    expect(issues).toContainEqual({ kind: 'badDate', path: 'people/anna-kralova-1880.md', detail: 'birth.date: 1880-13-45' });
    expect(issues).toContainEqual({ kind: 'missingFile', path: 'sources/o-vrbice-1825-f3.md', detail: 'attachments/sources/o-vrbice-1825-f4.jpg' });
    expect(issues).toContainEqual({ kind: 'unreadableFile', path: 'attachments/sources/o-vrbice-1825-f3-unreadable.jpg', detail: 'not a readable image/jpeg' });
    expect(issues).toContainEqual({ kind: 'confidenceDisagreement', path: 'sources/o-vrbice-1825-f3.md', detail: 'normal, high' });
    expect(dry.counts.issues.unmappedField).toMatchObject({ 'people.occupation': 1, 'parishes.denomination': 1 });
  });

  it('Vault says Living, dates say otherwise: the dry run lists the Person; relations differ while no Family root is marked', () => {
    expect(dry.plan.issues).toContainEqual({ kind: 'livingDiffers', path: 'people/anna-kralova-1880.md', detail: 'Vault: Living; the Tree: not Living' });
    // A Person with neither birth nor death recorded is Living (tree-model spec): three more differ.
    expect(dry.plan.comparisons.living).toBe(4);
    // With no Family root everyone is Unrelated: the four without nepribuzny differ.
    expect(dry.plan.comparisons.relation).toBe(4);
    expect(dry.plan.issues).toContainEqual({ kind: 'relationDiffers', path: 'people/jan-novak-1801.md', detail: 'Vault: relative; the Tree: unrelated' });
  });

  it('batch in the queue: the run submits one Import batch, shown with its Proposal count and the Agent', async () => {
    first = await runImport(options());
    expect(first.run.submitted).toBe(dry.run.submitted);
    const batches = await get('/api/batches', BatchList);
    expect(batches.items).toHaveLength(1);
    expect(batches.items[0]).toMatchObject({
      author: { displayName: 'Vault importer', isAgent: true },
      counts: { total: first.run.submitted, pending: first.run.submitted },
    });
    expect(batches.items[0]!.vaultCommit).toBeNull();
    // Leads wait for the batch: their Persons are not in the Tree yet.
    expect(first.run.leads).toEqual({ created: 0, waiting: 2, unchanged: 0 });
    const accept = await asOwner('POST', `/api/batches/${batches.items[0]!.id}/accept`, { proposals: first.run.submitted });
    expect(accept.statusCode, accept.body).toBe(200);
    expect(accept.json()).toMatchObject({ failed: [], blocked: [] });
  });

  it('baptism entry: one Proposal creates the baptism with child, father and mother, links the parents, and cites the page with its scan', async () => {
    const jan = await personByVault('person:jan-novak-1801');
    const baptism = jan.events.find((e) => e.event.type === 'baptism')!;
    const proposals = await s.t.db.selectFrom('proposal').select('id').where('note', '=', 'Vault: sources/n-vrbice-1801-f12.md').execute();
    expect(proposals).toHaveLength(1);
    const event = await get(`/api/events/${baptism.event.id}`, EventDetail);
    expect(event.roles.map((r) => [r.role, r.person.displayName]).sort()).toEqual([
      ['child', 'Jan Novák'],
      ['father', 'Tomáš Novák'],
      ['mother', 'Marie Nováková'],
    ]);
    expect(jan.familiesAsChild[0]!.partners.map((p) => p.displayName).sort()).toEqual(['Marie Nováková', 'Tomáš Novák']);
    const citation = await get(`/api/citations/${baptism.citations[0]!.id}`, CitationDetail);
    expect(citation).toMatchObject({ page: 'frame 12', readOn: '2026-10-01', source: { title: 'N Vrbice, Kamenná Lhota 1784–1820', reference: '123-4' } });
    expect(citation.images).toHaveLength(1);
    expect(citation.images[0]!.kind).toBe('page');
  });

  it("transcription kept: the body of the entry is the Citation's transcription", async () => {
    const jan = await personByVault('person:jan-novak-1801');
    const citation = await get(`/api/citations/${jan.events.find((e) => e.event.type === 'baptism')!.citations[0]!.id}`, CitationDetail);
    const note = await readFile(join(vault, 'sources/n-vrbice-1801-f12.md'), 'utf8');
    expect(citation.transcription).toBe(note.split('---\n').slice(2).join('---\n').trim());
    expect(citation.transcription).toContain('baptizatus est Joannes');
  });

  it('fact from the note body only: the death cites the Vault Source with the note path and low confidence', async () => {
    const jan = await personByVault('person:jan-novak-1801');
    const death = jan.events.find((e) => e.event.type === 'death')!;
    expect(death.event.house).not.toBeNull();
    expect(death.citations).toEqual([expect.objectContaining({ sourceTitle: 'Vault (rodokmen-data)', page: 'people/jan-novak-1801.md', confidence: 'low' })]);
  });

  it('probable Person: the entry only Jan cites comes in with normal confidence; Names, notes and Labels follow the note', async () => {
    const jan = await personByVault('person:jan-novak-1801');
    expect(jan.events.find((e) => e.event.type === 'baptism')!.citations[0]!.confidence).toBe('normal');
    expect(jan.names.map((n) => [n.asFound, n.type, n.language])).toEqual([
      ['Jan Novák', 'birth', 'cs'],
      ['Joannes', 'other', null],
      ['Nowak', 'other', null],
      ['Johann Nowak', 'other', null],
    ]);
    expect(jan.notes).toBe('Baptism found; the death is known from the family only. Check the death register of 1850.');
    const marie = await personByVault('person:marie-svobodova-1775');
    expect(marie.names.map((n) => [n.given, n.surname, n.type])).toEqual([
      ['Marie', 'Nováková', 'married'],
      ['Marie', 'Svobodová', 'birth'],
    ]);
  });

  it('line tag: obec/… and nepribuzny are derived, line/novak becomes a Label; the Tree computes Living itself', async () => {
    const anna = await personByVault('person:anna-kralova-1880');
    expect(anna.labels).toEqual(['line/novak']);
    expect(anna.living).toBe(false);
    // The date that is not EDTF is kept in the Event's description.
    expect(anna.events.find((e) => e.event.type === 'birth')!.event).toMatchObject({ date: null, description: 'Date as written in the Vault: 1880-13-45' });
  });

  it('broken link, real run: Tomáš is imported without the missing father', async () => {
    const tomas = await personByVault('person:tomas-novak-1770');
    expect(tomas.familiesAsChild).toEqual([]);
  });

  it('Places, Houses, the Parish and its registers: the Municipality linked by name and district, Place and Parish by the registers', async () => {
    const vrbice = await get(`/api/places/${await recordOf('place:vrbice')}`, PlaceDetail);
    expect(vrbice).toMatchObject({ name: 'Vrbice', municipality: { code: '572128', name: 'Vrbice' }, location: { lat: 50.38, lon: 15.39 } });
    expect(vrbice.names.map((n) => [n.name, n.language])).toEqual([
      ['Vrbice', 'cs'],
      ['Wrbitz', 'de'],
    ]);
    const place = await get(`/api/places/${await recordOf('place:kamenna-lhota')}`, PlaceDetail);
    expect(place).toMatchObject({ name: 'Kamenná Lhota', municipality: null, location: { lat: 49.61, lon: 15.32 } });
    expect(place.parishes.map((p) => p.parish.name)).toEqual(['Vrbice']);
    expect(place.houses[0]!.numbers.map((n) => n.number)).toEqual(['12', '12a']);
  });

  it('family document: the Source gets the PDF and the converted DOC as documents, with the original DOC kept', async () => {
    const sources = await get(`/api/sources?q=${encodeURIComponent('Rod Nováků')}`, SourceSearchResult);
    const source = await get(`/api/sources/${sources.items[0]!.id}`, SourceDetail);
    expect(source).toMatchObject({ type: 'family_account', familyAccount: { givenOn: '1936' } });
    expect(source.notes).toContain('A typescript of 1936');
    expect(source.documents.map((d) => [d.title, d.original?.contentType ?? null])).toEqual([
      ['rod-novaku.pdf', null],
      ['rod-novaku.doc', 'application/msword'],
    ]);
  });

  it('negative search in a log: a Research lead exists, closed as not found, with that search record; the plan is an open lead', async () => {
    const leadsRun = await runImport(options());
    expect(leadsRun.run.submitted).toBe(0);
    expect(leadsRun.run.leads).toEqual({ created: 2, waiting: 0, unchanged: 0 });
    const list = await get('/api/leads?limit=50', LeadList);
    const log = list.items.find((l) => l.question === 'Baptism of Tomáš Novák')!;
    expect(log.status).toBe('not_found');
    const detail = await get(`/api/leads/${log.id}`, LeadDetail);
    expect(detail.searches).toHaveLength(1);
    expect(detail.searches[0]).toMatchObject({
      years: { from: 1784, to: 1820 },
      pages: '1–60',
      found: false,
      searchedOn: '2026-10-20',
      searchedBy: 'Invented agent',
    });
    expect(detail.searches[0]!.source?.title).toBe('N Vrbice, Kamenná Lhota 1784–1820');
    const plan = list.items.find((l) => l.question === 'Find the baptism of Tomáš Novák')!;
    expect(plan.status).toBe('open');
    expect(plan.persons.map((p) => p.displayName).sort()).toEqual(['Jan Novák', 'Tomáš Novák']);
    expect(plan.places.map((p) => p.name)).toEqual(['Vrbice']);
  });

  it('second run after edits: one new Person note gives one new Proposal, and no existing Person is duplicated', async () => {
    await writeFile(
      join(vault, 'people/vaclav-novak-1803.md'),
      `---\ntype: person\nname:\n  given: Václav\n  surname: Novák\nsex: M\nliving: false\nconfidence: probable\ntags: [line/novak]\nfather: "[[tomas-novak-1770]]"\nmother: "[[marie-svobodova-1775]]"\n---\n`,
    );
    const before = await counts();
    const second = await runImport(options());
    expect(second.run.submitted).toBe(1);
    expect(second.run.leads.unchanged).toBe(2);
    const after = await counts();
    expect(after.proposals).toBe(before.proposals + 1);
    expect(after.batches).toBe(before.batches + 1);
    const [proposal] = (await get(`/api/batches/${second.run.batch!.id}/proposals`, ProposalList)).items;
    expect(proposal!.operations.map((o) => o.operation.op)).toEqual(['createPerson', 'addLabel', 'linkChild', 'createCitation']);
    // It links into the Family already in the Tree, not a new one.
    const link = proposal!.operations[2]!.operation;
    expect(link.op === 'linkChild' ? link.familyId : '').toMatch(/^[0-9a-f-]{36}$/);
    const accept = await asOwner('POST', `/api/batches/${second.run.batch!.id}/accept`, { proposals: 1 });
    expect(accept.statusCode, accept.body).toBe(200);
    expect((await counts()).persons).toBe(before.persons + 1);
    const hits = (await get(`/api/persons?q=${encodeURIComponent('Tomáš Novák')}&limit=50`, PersonSearchResult)).items;
    expect(hits.filter((h) => h.person.displayName === 'Tomáš Novák' && h.person.birth === null)).toHaveLength(1);
    // A third run finds nothing new.
    expect((await runImport(options())).run.submitted).toBe(0);
  });

  it('only with an Agent token the server knows', async () => {
    await expect(runImport(options({ token: 'rdk_ag_not-a-token' }))).rejects.toThrow(/401/);
    expect((await s.app.inject({ method: 'GET', url: '/api/import-map', headers: bearer(token) })).statusCode).toBe(200);
  });
});
