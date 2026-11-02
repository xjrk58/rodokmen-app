import { foldForSearch, PersonSearchResult, PlaceSearchResult, SourceSearchResult } from '@rodokmen/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, ensureOwner, makeApp, signIn, type TestApp } from './helpers.js';

/**
 * Words as registers and relatives write them: Czech, German, Latin ligatures, Polish and other
 * letters Unicode does not decompose, capitals, combining accents and odd whitespace. Inputs carry
 * no outer whitespace, which foldForSearch trims and rdk_fold keeps.
 */
const WORDS = [
  'Novák Nováková Šťastný Řehoř Dvořáček Ůhel Čeněk Ďáblice Ťuhýk Ňadra',
  'NOVÁK ŘEHOŘ ŽOFIE',
  'Müller Größe Straße GROẞE Weiß Ölmühle Äbtissin',
  'Mariæ Cæcilia ÆGIDIUS Phœbe Œlschläger',
  'Łukasz Łąka Żółć Wrocław',
  'Ørsted Søren Øresund',
  'Đorđe Đurić',
  'Ðorn Þóra Ħal Ŧomas Ŋoma ıstanbul İzmir Ŀlorenç',
  'Ĳssel ǅuro Ǆungla ǉubica ǌegoš ﬁlia ﬂos ſanctus ƒ',
  'Jose\u0301 Nova\u0301k Ma\u0308dchen',
  'two  spaces\ttab\nnewline\u2009thin\u3000wide\u2028line',
  // No-break spaces and U+FEFF are spaces too (migration 0005); U+0085 is not.
  'Lhota\u00a0u\u00a0Kolína 1\u202f801 12\u2007a \ufeffBOM x\u0085y',
  '^`~ 12a čp. 15 (1801)',
];

describe('search folding: shared foldForSearch and the database rdk_fold agree', () => {
  let t: TestDatabase;
  let a: TestApp;
  let cookie: string;

  beforeAll(async () => {
    t = await createTestDatabase();
    a = await makeApp(t);
    await ensureOwner(t.db);
    cookie = await signIn(t.db, a.clock, await createMember(t.db));
  });
  afterAll(async () => {
    await a?.app.close();
    await t?.drop();
  });

  it('folds every word of the table the same way', async () => {
    const { rows } = await sql<{
      input: string;
      folded: string;
    }>`select input, rdk_fold(input) as folded from unnest(${sql.val(WORDS)}::text[]) as input`.execute(t.db);
    expect(rows.map((r) => [r.input, foldForSearch(r.input)])).toEqual(rows.map((r) => [r.input, r.folded]));
  });

  it('finds a Person whatever the spelling of æ, ł, ß or ø, in both directions', async () => {
    const personId = await t.db.transaction().execute(async (tx) => {
      const { id } = await tx.insertInto('person').values({ sex: 'female' }).returning('id').executeTakeFirstOrThrow();
      await tx
        .insertInto('name')
        .values({ person_id: id, given: 'Cæcilia', surname: 'Łukaszová', type: 'birth', as_found: 'Caecilia Lukaszowa', is_primary: true })
        .execute();
      await tx
        .insertInto('name')
        .values({ person_id: id, given: 'Cäcilie', surname: 'Großmann', type: 'other', language: 'de', as_found: 'Cäcilie Großmann', sort_order: 1 })
        .execute();
      return id;
    });
    for (const q of ['Cæcilia', 'caecilia', 'ŁUKASZOVÁ', 'lukaszova', 'Grossmann', 'GROẞMANN', 'Cæcilia Łukaszová']) {
      const res = await a.app.inject({ method: 'GET', url: `/api/persons?q=${encodeURIComponent(q)}`, headers: { cookie } });
      expect(
        PersonSearchResult.parse(res.json()).items.map((i) => i.person.id),
        q,
      ).toContain(personId);
    }
  });

  it('finds Places and Sources the same way', async () => {
    const placeId = await t.db.transaction().execute(async (tx) => {
      const { id } = await tx.insertInto('place').values({ type: 'village' }).returning('id').executeTakeFirstOrThrow();
      await tx.insertInto('place_name').values({ place_id: id, name: 'Łąka nad Ørem', language: 'cs', is_primary: true }).execute();
      return id;
    });
    const { id: sourceId } = await t.db
      .insertInto('source')
      .values({ type: 'parish_register', title: 'Liber baptizatorum ecclesiæ Łąka' })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const q of ['Łąka', 'laka nad orem', 'ŁĄKA NAD ØREM']) {
      const res = await a.app.inject({ method: 'GET', url: `/api/places?q=${encodeURIComponent(q)}`, headers: { cookie } });
      expect(
        PlaceSearchResult.parse(res.json()).items.map((p) => p.id),
        q,
      ).toContain(placeId);
    }
    for (const q of ['ecclesiæ', 'ecclesiae łąka', 'ECCLESIAE LAKA']) {
      const res = await a.app.inject({ method: 'GET', url: `/api/sources?q=${encodeURIComponent(q)}`, headers: { cookie } });
      expect(
        SourceSearchResult.parse(res.json()).items.map((s) => s.id),
        q,
      ).toContain(sourceId);
    }
  });

  it('finds a name written with no-break spaces by a query typed with ordinary ones', async () => {
    const placeId = await t.db.transaction().execute(async (tx) => {
      const { id } = await tx.insertInto('place').values({ type: 'village' }).returning('id').executeTakeFirstOrThrow();
      await tx.insertInto('place_name').values({ place_id: id, name: 'Lhota\u00a0u\u00a0Kolína', language: 'cs', is_primary: true }).execute();
      return id;
    });
    const res = await a.app.inject({ method: 'GET', url: `/api/places?q=${encodeURIComponent('lhota u kolina')}`, headers: { cookie } });
    expect(PlaceSearchResult.parse(res.json()).items.map((p) => p.id)).toContain(placeId);
  });
});
