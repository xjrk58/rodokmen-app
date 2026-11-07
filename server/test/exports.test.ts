import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type OperationInput } from '@rodokmen/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { loadConfig } from '../src/config.js';
import type { Account } from '../src/db/types.js';
import { gatherExport, withoutMediaInText, yearOf } from '../src/export/gather.js';
import { gedcomDate, gedcomFile } from '../src/export/gedcom.js';
import type { ExportRepoConfig } from '../src/export/repo.js';
import { exportFiles, runExport } from '../src/export/run.js';
import { generateFixture } from '../src/fixture/generate.js';
import { dailyJobs } from '../src/jobs/daily.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, ensureOwner, makeApp, signIn, testConfig, type TestApp } from './helpers.js';
import { citation, newKey } from './proposal-testbed.js';

const L = generateFixture().landmarks;

/** Runs git in a folder and returns its output. */
const git = (dir: string, ...args: string[]) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } }).trim();

/**
 * A structural check of GEDCOM 5.5.1 (exports spec, "GEDCOM download for the Owner"): line
 * syntax and length, levels, the header and trailer, and that every pointer names a record and
 * that Family links agree both ways. Returns the problems found.
 */
function gedcomProblems(text: string): string[] {
  const problems: string[] = [];
  const lines = text.split('\n').filter((l) => l !== '');
  const defined = new Map<string, string>();
  const pointers: Array<{ from: string; tag: string; to: string }> = [];
  let level = -1;
  let current = '';
  const TAGS = new Set(
    'HEAD SOUR NAME SUBM GEDC VERS FORM CHAR INDI GIVN SURN TYPE SEX BIRT CHR DEAT BURI RESI CENS EVEN DATE PLAC MAP LATI LONG ADDR ADR1 NOTE CONT CONC PAGE QUAY DATA TEXT ASSO RELA FAMC PEDI FAMS FAM HUSB WIFE CHIL MARR TITL AUTH PUBL REPO CALN TRLR'.split(' '),
  );
  for (const [i, line] of lines.entries()) {
    if (line.length > 255) problems.push(`line ${i + 1} is longer than 255 characters`);
    const m = /^(\d+) (?:(@[A-Z0-9]+@) )?([A-Z0-9_]+)(?: (.*))?$/.exec(line);
    if (!m) {
      problems.push(`line ${i + 1} is not a GEDCOM line: ${line}`);
      continue;
    }
    const [, lv, id, tag, value] = m;
    const n = Number(lv);
    if (n > level + 1) problems.push(`line ${i + 1} jumps from level ${level} to ${n}`);
    level = n;
    if (!TAGS.has(tag!)) problems.push(`line ${i + 1}: tag ${tag} is not one this writer should use`);
    if (n === 0) {
      current = id ?? tag!;
      if (id) defined.set(id, tag!);
    }
    if (value && /^@[A-Z0-9]+@$/.test(value)) pointers.push({ from: current, tag: tag!, to: value });
    if (value && /(^|[^@])@([^@]|$)/.test(value) && !/^@[A-Z0-9]+@$/.test(value)) problems.push(`line ${i + 1}: an @ in a value is not doubled`);
  }
  if (lines[0] !== '0 HEAD') problems.push('the file does not start with 0 HEAD');
  if (lines[lines.length - 1] !== '0 TRLR') problems.push('the file does not end with 0 TRLR');
  if (!lines.includes('2 VERS 5.5.1') || !lines.includes('1 CHAR UTF-8')) problems.push('the header does not say GEDCOM 5.5.1 in UTF-8');
  for (const p of pointers) if (!defined.has(p.to)) problems.push(`${p.from} ${p.tag} points at ${p.to}, which is not defined`);
  const has = (from: string, tag: string, to: string) => pointers.some((p) => p.from === from && p.tag === tag && p.to === to);
  for (const p of pointers) {
    if (p.tag === 'FAMC' && !has(p.to, 'CHIL', p.from)) problems.push(`${p.from} is a child of ${p.to}, which does not list it`);
    if (p.tag === 'FAMS' && !has(p.to, 'HUSB', p.from) && !has(p.to, 'WIFE', p.from)) problems.push(`${p.from} is a partner in ${p.to}, which does not list it`);
    if (p.tag === 'CHIL' && !has(p.to, 'FAMC', p.from)) problems.push(`${p.to} is listed as a child of ${p.from} without FAMC`);
  }
  return problems;
}

/** The block of lines of one GEDCOM record. */
function gedcomRecord(text: string, xrefId: string): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`0 ${xrefId} `));
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && l.startsWith('0 '));
  return lines.slice(start, end);
}

describe('Exports', () => {
  let t: TestDatabase;
  let a: TestApp;
  let owner: Account;
  let editor: Account;
  const cookies = new Map<string, string>();
  let grandchild: string;
  let bare: string;
  let repo: ExportRepoConfig;
  const tmp = mkdtempSync(join(tmpdir(), 'rodokmen-export-test-'));

  const call = (m: Account, method: 'GET' | 'POST', url: string, payload?: object) =>
    a.app.inject({ method, url, headers: { cookie: cookies.get(m.id)! }, ...(payload === undefined ? {} : { payload }) });
  const direct = async (operations: OperationInput[]) => {
    const res = await call(editor, 'POST', '/api/proposals', { formatVersion: 1, idempotencyKey: newKey(), note: null, operations, direct: true });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ id: string }>();
  };
  const personByName = async (given: string, surname: string) =>
    (await t.db.selectFrom('name').select('person_id').where('given', '=', given).where('surname', '=', surname).executeTakeFirstOrThrow()).person_id;
  const nightly = () => runExport({ db: t.db, clock: a.clock, repo }, '2026-11-05');

  beforeAll(async () => {
    t = await createTestDatabase();
    a = await makeApp(t);
    owner = await ensureOwner(t.db);
    editor = await createMember(t.db, 'editor', { displayName: 'Eva Editor' });
    for (const m of [owner, editor]) cookies.set(m.id, await signIn(t.db, a.clock, m));

    // An invented Living grandchild, born 2010 in a House of Kamenná Lhota, with a Citation, a
    // nickname, a Label and notes. Jan Novák is named as the father at the birth (an invented
    // test, whatever the dates), so his note must not show the birth either.
    await direct([
      ...citation('G'),
      { op: 'createPerson', tempId: 'tmp:g', sex: 'male', name: { given: 'Tobiáš', surname: 'Vnoučátko', type: 'birth', asFound: 'Tobiáš Vnoučátko' } },
      { op: 'addName', personId: 'tmp:g', given: 'Tobi', surname: '', type: 'nickname', asFound: 'Tobi' },
      { op: 'linkChild', familyId: L.janSecondFamily, childId: 'tmp:g', linkType: 'birth' },
      { op: 'createEvent', tempId: 'tmp:b', type: 'birth', date: '2010-03-04', houseId: L.houseA },
      { op: 'addRole', eventId: 'tmp:b', personId: 'tmp:g', role: 'child' },
      { op: 'addRole', eventId: 'tmp:b', personId: L.janNovak, role: 'father' },
      { op: 'attachCitation', citationId: 'tmp:citG', eventId: 'tmp:b' },
      { op: 'addLabel', personId: 'tmp:g', label: 'line/invented' },
      { op: 'setNotes', record: 'person', id: 'tmp:g', notes: 'Invented note: plays the violin in Kamenná Lhota.' },
    ]);
    grandchild = await personByName('Tobiáš', 'Vnoučátko');

    // A document on a Source, and notes with an image embed and a link to a PDF.
    const source = (await t.db.selectFrom('source').select('id').orderBy('id').executeTakeFirstOrThrow()).id;
    await t.db
      .insertInto('source_document')
      .values({ source_id: source, title: 'Invented scan.pdf', storage_key: 'documents/invented.pdf', content_type: 'application/pdf', byte_size: 10, sha256: 'd'.repeat(64) })
      .execute();
    await t.db
      .updateTable('person')
      .set({ notes: 'See ![the page](/api/images/0192f0c4-7a1e-7c3b-9d2a-00000000feed) and [the PDF](https://archive.example/scan-17.pdf) and [the catalogue](https://archive.example/catalogue).' })
      .where('id', '=', L.janNovak)
      .execute();

    bare = join(tmp, 'rodokmen-export.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    repo = { url: bare, branch: 'main', sshKey: null, knownHosts: null, author: { name: 'Rodokmen', email: 'export@localhost' } };
  });
  afterAll(async () => {
    await a?.app.close();
    await t?.drop();
    rmSync(tmp, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------- 1.1, 2.2: the Living grandchild

  it('reduces a Living grandchild to name, sex, relationships and birth year in the view (task 1.1)', async () => {
    const tree = await gatherExport(t.db, a.clock);
    const view = tree.records.find((r) => r.id === grandchild)!;
    expect(view).toMatchObject({ living: true, sex: 'male', hasBirthYear: true, birthYear: 2010, events: [], facts: [], notes: '', links: [] });
    expect(view.names).toEqual([{ given: 'Tobiáš', surname: 'Vnoučátko', type: '', language: '', asFound: '', citations: [] }]);
    expect(view.relations).toEqual([{ rel: 'childOf', target: L.janSecondFamily, detail: 'birth' }]);
    // No record shows the Event a Living person took part in.
    expect(JSON.stringify(tree.records)).not.toContain('2010-03-04');
  });

  it('writes the Living grandchild into GEDCOM with the name, sex, family links and BIRT DATE 2010 only (task 2.2)', async () => {
    const ged = gedcomFile(await gatherExport(t.db, a.clock));
    const xref = `@I${grandchild.replace(/-/g, '').slice(-16).toUpperCase()}@`;
    expect(gedcomRecord(ged, xref)).toEqual([
      `0 ${xref} INDI`,
      '1 NAME Tobiáš /Vnoučátko/',
      '2 GIVN Tobiáš',
      '2 SURN Vnoučátko',
      '1 SEX M',
      '1 BIRT',
      '2 DATE 2010',
      `1 FAMC @F${L.janSecondFamily.replace(/-/g, '').slice(-16).toUpperCase()}@`,
      '2 PEDI birth',
    ]);
    expect(ged).not.toContain('Tobi\n');
    expect(ged).not.toContain('violin');
    expect(ged).not.toContain('4 MAR 2010');
  });

  it('passes a structural GEDCOM 5.5.1 check: syntax, levels, header, pointers and Family links (task 2.2)', async () => {
    const ged = gedcomFile(await gatherExport(t.db, a.clock));
    expect(gedcomProblems(ged)).toEqual([]);
    expect(ged.split('\n').filter((l) => / INDI$/.test(l)).length).toBeGreaterThan(100);
  });

  it('turns EDTF dates into GEDCOM dates', () => {
    expect(gedcomDate('1801-02-06')).toBe('6 FEB 1801');
    expect(gedcomDate('1801-02')).toBe('FEB 1801');
    expect(gedcomDate('1801')).toBe('1801');
    expect(gedcomDate('1801~')).toBe('ABT 1801');
    expect(gedcomDate('1801?')).toBe('EST 1801');
    expect(gedcomDate('1801/1805')).toBe('BET 1801 AND 1805');
    expect(gedcomDate('../1801-03')).toBe('BEF MAR 1801');
    expect(gedcomDate('1801/..')).toBe('AFT 1801');
    expect(yearOf('2010-03-04')).toBe(2010);
    expect(yearOf('2010~')).toBe(2010);
    expect(yearOf('2008/2010')).toBeNull();
  });

  // ---------------------------------------------------------------- 2.1: the Markdown notes

  it('writes one note per record with YAML frontmatter and [[links]] that all resolve, as in an Obsidian vault (task 2.1)', async () => {
    const files = await exportFiles(t.db, a.clock);
    const folders = new Set([...files.keys()].map((p) => p.split('/')[0]));
    for (const f of ['people', 'families', 'places', 'houses', 'parishes', 'estates', 'sources', 'leads', 'README.md', 'family.ged']) expect(folders).toContain(f);
    const notes = [...files].filter(([p]) => p.endsWith('.md') && p !== 'README.md');
    const basenames = new Set(notes.map(([p]) => p.split('/').pop()!.replace(/\.md$/, '')));
    expect(basenames.size).toBe(notes.length);
    const broken: string[] = [];
    for (const [path, text] of notes) {
      const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
      expect(m, path).not.toBeNull();
      const front = parse(m![1]!) as { id?: string; type?: string };
      expect(front.id, path).toMatch(/^[0-9a-f-]{36}$/);
      for (const link of text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) if (!basenames.has(link[1]!)) broken.push(`${path} → ${link[1]}`);
    }
    expect(broken).toEqual([]);
  });

  it('keeps the Living grandchild to name, sex, Families and birth year in Markdown, and their parent’s note does not give the birth', async () => {
    const files = await exportFiles(t.db, a.clock);
    const [path, text] = [...files].find(([, x]) => x.includes(`id: ${grandchild}`))!;
    expect(path).toBe('people/tobias-vnoucatko-2010.md');
    expect(text).toContain('living: true');
    expect(text).toContain('birthYear: 2010');
    for (const gone of ['2010-03-04', 'Tobi\n', 'violin', 'line/invented', 'Invented register G', 'relation:']) expect(text).not.toContain(gone);
    const jan = [...files.values()].find((x) => x.includes(`id: ${L.janNovak}`))!;
    expect(jan).not.toContain('2010-03-04');
    expect(jan).not.toContain('Tobiáš');
  });

  it('keeps slugs stable after a Name correction (task 2.1)', async () => {
    const before = [...(await exportFiles(t.db, a.clock))].find(([, x]) => x.includes(`id: ${L.janNovak}`))![0];
    const primary = await t.db.selectFrom('name').select(['id', 'version']).where('person_id', '=', L.janNovak).where('is_primary', '=', true).executeTakeFirstOrThrow();
    await direct([...citation('N'), { op: 'setField', record: 'name', id: primary.id, baseVersion: primary.version, set: { given: 'Johann' } }]);
    const after = await exportFiles(t.db, a.clock);
    const [path, text] = [...after].find(([, x]) => x.includes(`id: ${L.janNovak}`))!;
    expect(path).toBe(before);
    expect(text).toContain('# Johann ');
  });

  // ---------------------------------------------------------------- 2.3: no images

  it('leaves out page images, portraits, documents and links to them, and keeps a Citation’s text and confidence (task 2.3)', async () => {
    const files = await exportFiles(t.db, a.clock);
    const all = [...files.values()].join('\n');
    for (const gone of ['/api/images/', '/api/documents/', 'scan-17.pdf', 'Invented scan.pdf', '.jpg', '.webp', 'OBJE', 'page image']) expect(all).not.toContain(gone);
    expect(all).toContain('https://archive.example/catalogue');
    // Jan's baptism has a Citation with a page image (the fixture's): its text and confidence go.
    const baptism = await t.db
      .selectFrom('event_citation as ec')
      .innerJoin('citation as c', 'c.id', 'ec.citation_id')
      .innerJoin('image as i', 'i.citation_id', 'c.id')
      .select(['c.transcription', 'c.confidence'])
      .where('ec.event_id', '=', L.janBaptism)
      .executeTakeFirstOrThrow();
    const firstLine = baptism.transcription.split('\n')[0]!;
    const jan = [...files.values()].find((x) => x.includes(`id: ${L.janNovak}`))!;
    expect(jan).toContain(firstLine);
    expect(jan).toContain(`confidence ${baptism.confidence.replace('_', ' ')}`);
    expect(files.get('family.ged')).toContain(firstLine.slice(0, 40));
  });

  it('takes image embeds and links to images and documents out of notes', () => {
    expect(withoutMediaInText('a ![page 3](https://files.example/x.jpg) b [PDF](/api/documents/1) c [web](https://example.org/a) https://x.example/p.png d')).toBe(
      'a page 3 b PDF c [web](https://example.org/a)  d',
    );
  });

  // ---------------------------------------------------------------- research-leads 1.4: leads in the Export

  it('drops links to Living people from exported leads, and leaves out a lead about Living people only (research-leads task 1.4)', async () => {
    const write = async (body: object) => {
      const res = await call(editor, 'POST', '/api/leads', body);
      expect(res.statusCode, res.body).toBe(201);
      return res.json<{ id: string }>().id;
    };
    const both = await write({ question: 'Invented lead about two people', reason: 'R', personIds: [grandchild, L.janNovak] });
    const only = await write({ question: 'Invented lead about the grandchild', reason: 'R', personIds: [grandchild] });
    const files = await exportFiles(t.db, a.clock);
    const leads = [...files].filter(([p]) => p.startsWith('leads/'));
    expect(leads.some(([, x]) => x.includes(`id: ${only}`))).toBe(false);
    const kept = leads.find(([, x]) => x.includes(`id: ${both}`))![1];
    expect(kept).toContain('[[');
    expect(kept).not.toContain('tobias-vnoucatko');
    expect(kept).not.toContain('Tobiáš');
  });

  // ---------------------------------------------------------------- 3.1: the nightly Export

  it('is off unless the Owner switches it on and names the repository', async () => {
    expect(testConfig(t.url).export).toBeNull();
    expect(dailyJobs({ db: t.db, clock: a.clock, mailer: a.mailer, images: undefined as never, publicOrigin: 'x' }).map((j) => j.name)).not.toContain('nightly-export');
    expect(dailyJobs({ db: t.db, clock: a.clock, mailer: a.mailer, images: undefined as never, publicOrigin: 'x', exportRepo: repo }).map((j) => j.name)).toContain(
      'nightly-export',
    );
    expect(await runExport({ db: t.db, clock: a.clock, repo: null }, '2026-11-05')).toEqual({ detail: 'the Export is off', complete: true });
    expect(() => loadConfig({ NODE_ENV: 'test', RODOKMEN_EXPORT_ENABLED: 'true' })).toThrow(/RODOKMEN_EXPORT_REPO/);
    expect(() => loadConfig({ NODE_ENV: 'test', RODOKMEN_EXPORT_ENABLED: 'true', RODOKMEN_EXPORT_REPO: 'git@github.invalid:o/r.git', RODOKMEN_EXPORT_SSH_KEY: '/k' })).toThrow(
      /KNOWN_HOSTS/,
    );
    expect(loadConfig({ NODE_ENV: 'test', RODOKMEN_EXPORT_ENABLED: 'true', RODOKMEN_EXPORT_REPO: '/srv/x.git' }).export).toMatchObject({ url: '/srv/x.git', branch: 'main' });
  });

  it('commits the first Export, and makes no commit on a night without changes (scenario "Night without changes")', async () => {
    expect((await nightly()).detail).toMatch(/^committed [0-9a-f]{40}/);
    expect(git(bare, 'rev-list', '--count', 'main')).toBe('1');
    const listed = git(bare, 'ls-tree', '-r', '--name-only', 'main').split('\n');
    expect(listed).toContain('family.ged');
    expect(listed).toContain('people/tobias-vnoucatko-2010.md');
    expect((await nightly()).detail).toMatch(/^no change/);
    expect(git(bare, 'rev-list', '--count', 'main')).toBe('1');
  });

  it('makes one commit that updates the affected notes and the GEDCOM file after a day of accepted Proposals (scenario "Night after changes")', async () => {
    const jan = await t.db.selectFrom('person').select('version').where('id', '=', L.janNovak).executeTakeFirstOrThrow();
    await direct([...citation('S'), { op: 'addName', personId: L.janNovak, baseVersion: jan.version, given: 'Joannes', surname: 'Novacius', type: 'latin', asFound: 'Joannes Novacius' }]);
    expect((await nightly()).detail).toMatch(/^committed/);
    expect(git(bare, 'rev-list', '--count', 'main')).toBe('2');
    const changed = git(bare, 'diff', '--name-only', 'main~1', 'main').split('\n');
    expect(changed).toContain('family.ged');
    expect(changed.some((p) => p.startsWith('people/'))).toBe(true);
    expect(changed.every((p) => p === 'family.ged' || p.startsWith('people/') || p.startsWith('sources/'))).toBe(true);
  });

  it('overwrites a note edited by hand in the repository at the next Export, and the Tree is unaffected (scenario "Someone edits a note in the repo")', async () => {
    const clone = join(tmp, 'hand');
    execFileSync('git', ['clone', '-q', bare, clone]);
    const note = 'people/tobias-vnoucatko-2010.md';
    const original = git(clone, 'show', `HEAD:${note}`);
    writeFileSync(join(clone, note), 'Edited by hand.\n');
    git(clone, '-c', 'user.name=Someone', '-c', 'user.email=someone@example.invalid', 'commit', '-qam', 'Hand edit');
    git(clone, 'push', '-q', 'origin', 'HEAD:main');
    const persons = (await t.db.selectFrom('person').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n;
    expect((await nightly()).detail).toMatch(/^committed/);
    expect(git(bare, 'show', `main:${note}`)).toBe(original);
    expect((await t.db.selectFrom('person').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n).toBe(persons);
  });

  // ---------------------------------------------------------------- 3.2: the Owner's download

  it('lets only the Owner download the GEDCOM file, and it is the nightly one (task 3.2)', async () => {
    const res = await call(owner, 'GET', '/api/export/family.ged');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="family.ged"');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(`${res.body.trimEnd()}`).toBe(git(bare, 'show', 'main:family.ged'));
    expect((await call(editor, 'GET', '/api/export/family.ged')).statusCode).toBe(403);
    const contributor = await createMember(t.db, 'contributor', { displayName: 'Karel Contributor' });
    cookies.set(contributor.id, await signIn(t.db, a.clock, contributor));
    expect((await call(contributor, 'GET', '/api/export/family.ged')).statusCode).toBe(403);
    expect((await a.app.inject({ method: 'GET', url: '/api/export/family.ged' })).statusCode).toBe(401);
  });
});
