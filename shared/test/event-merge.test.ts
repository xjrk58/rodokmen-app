import { describe, expect, it } from 'vitest';
import { mergeEventFacts, mergeOffer, rolesAgree, type EventFacts, type EventRole, type OfferedEvent } from '../src/index.js';

// Invented Persons, Places and Houses: only their ids matter here.
const P = { jan: 'p-jan', marie: 'p-marie', anna: 'p-anna', matej: 'p-matej', brother: 'p-brother', godmother: 'p-godmother', priest: 'p-priest' };
const PLACE = 'place-kamenna-lhota';
const HOUSE = 'house-12';
const LIMITS = [4000, 50_000] as const;

const facts = (over: Partial<EventFacts> = {}): EventFacts => ({
  type: 'marriage',
  typeDetail: '',
  date: '1801-11-20',
  placeId: PLACE,
  houseId: '',
  description: '',
  notes: '',
  ...over,
});
const role = (personId: string, r: string): EventRole => ({ personId, role: r });
const partners: EventRole[] = [role(P.jan, 'partner'), role(P.marie, 'partner')];
const merge = (keep: EventFacts, other: EventFacts, keepRoles: EventRole[] = partners, mergeRoles: EventRole[] = partners) =>
  mergeEventFacts(keep, other, keepRoles, mergeRoles, ...LIMITS);

describe('merging one Event into another', () => {
  it('marriage recorded twice: no conflict, and the kept Event as it was', () => {
    const m = merge(facts(), facts());
    expect(m.conflicts).toEqual([]);
    expect(m.kept).toEqual(facts());
  });

  it('gaps are filled: an undated burial at a Place into a dated burial without one', () => {
    const keep = facts({ type: 'burial', date: '1850-03-02', placeId: '' });
    const other = facts({ type: 'burial', date: '', placeId: PLACE });
    const m = merge(keep, other, [role(P.jan, 'deceased')], [role(P.jan, 'deceased')]);
    expect(m.conflicts).toEqual([]);
    expect(m.kept).toMatchObject({ date: '1850-03-02', placeId: PLACE, houseId: '' });
  });

  it('Place and House are one slot: a House fills an Event with neither, and differs from a Place', () => {
    expect(merge(facts({ placeId: '' }), facts({ placeId: '', houseId: HOUSE })).kept).toMatchObject({ placeId: '', houseId: HOUSE });
    expect(merge(facts(), facts({ placeId: '', houseId: HOUSE })).conflicts).toEqual(['place']);
  });

  it('notes of both: the kept Event first, a blank line, then the merged one; equal or empty texts are not doubled', () => {
    const m = merge(
      facts({ notes: 'Entry checked against the index' }),
      facts({ notes: "Godmother's name hard to read", description: 'In the bride’s house' }),
    );
    expect(m.kept.notes).toBe("Entry checked against the index\n\nGodmother's name hard to read");
    expect(m.kept.description).toBe('In the bride’s house');
    expect(merge(facts({ notes: 'Same' }), facts({ notes: 'Same' })).kept.notes).toBe('Same');
  });

  it('refuses, naming each fact: type, type detail, date, place, roles, and text too long', () => {
    expect(merge(facts(), facts({ type: 'baptism' })).conflicts).toEqual(['type']);
    expect(merge(facts({ type: 'other', typeDetail: 'betrothal' }), facts({ type: 'other', typeDetail: 'banns' })).conflicts).toEqual(['type']);
    expect(merge(facts({ date: '1812-02-11' }), facts({ date: '1812-02-12' })).conflicts).toEqual(['date']);
    expect(merge(facts({ date: '1801' }), facts({ date: '1801-11-20' })).conflicts).toEqual(['date']);
    expect(merge(facts(), facts({ placeId: 'place-elsewhere' })).conflicts).toEqual(['place']);
    expect(
      mergeEventFacts(facts({ description: 'x'.repeat(3000) }), facts({ description: 'y'.repeat(1000) }), partners, partners, ...LIMITS).conflicts,
    ).toEqual(['description']);
    expect(merge(facts({ date: '1801' }), facts({ type: 'death', date: '1802', placeId: 'elsewhere' })).conflicts).toEqual(['type', 'date', 'place']);
  });

  it('two different children are refused; partners A and B merge with A alone, but not with A and C', () => {
    const baptism = facts({ type: 'baptism' });
    expect(merge(baptism, baptism, [role(P.matej, 'child')], [role(P.brother, 'child')]).conflicts).toEqual(['roles']);
    expect(merge(facts(), facts(), partners, [role(P.jan, 'partner')]).conflicts).toEqual([]);
    expect(merge(facts(), facts(), [role(P.jan, 'partner')], partners).conflicts).toEqual([]);
    expect(merge(facts(), facts(), partners, [role(P.jan, 'partner'), role(P.anna, 'partner')]).conflicts).toEqual(['roles']);
    expect(merge(facts(), facts(), [role(P.jan, 'partner')], [role(P.anna, 'partner')]).conflicts).toEqual(['roles']);
  });

  it('other Roles add up; one Person in two principal Roles is refused', () => {
    const baptism = facts({ type: 'baptism' });
    const kept = [role(P.matej, 'child'), role(P.jan, 'father')];
    expect(merge(baptism, baptism, kept, [role(P.matej, 'child'), role(P.godmother, 'godparent'), role(P.priest, 'priest')]).conflicts).toEqual([]);
    expect(merge(baptism, baptism, kept, [role(P.jan, 'child')]).conflicts).toEqual(['roles']);
    expect(rolesAgree(kept, [role(P.jan, 'godparent')])).toBe(true);
  });

  it('is symmetric in what it refuses', () => {
    const pairs: Array<[EventFacts, EventFacts, EventRole[], EventRole[]]> = [
      [facts(), facts({ date: '' }), partners, [role(P.jan, 'partner')]],
      [facts({ date: '1801' }), facts(), partners, partners],
      [facts(), facts(), partners, [role(P.jan, 'partner'), role(P.anna, 'partner')]],
    ];
    for (const [a, b, ra, rb] of pairs) expect(mergeEventFacts(a, b, ra, rb, ...LIMITS).conflicts).toEqual(mergeEventFacts(b, a, rb, ra, ...LIMITS).conflicts);
  });
});

describe('the offer on the person page', () => {
  const event = (over: Partial<OfferedEvent> = {}): OfferedEvent => ({
    facts: facts(),
    roles: partners,
    role: 'partner',
    citations: 1,
    createdAt: 1000,
    ...over,
  });

  it('marriage recorded twice is offered, keeping the one with more Citations, else the older', () => {
    expect(mergeOffer(event({ citations: 1 }), event({ citations: 2 }), ...LIMITS)).toEqual({ offered: true, keepFirst: false });
    expect(mergeOffer(event({ createdAt: 2000 }), event({ createdAt: 1000 }), ...LIMITS)).toEqual({ offered: true, keepFirst: false });
    expect(mergeOffer(event({ createdAt: 1000 }), event({ createdAt: 2000 }), ...LIMITS)).toEqual({ offered: true, keepFirst: true });
  });

  it('two residences in different years, another type, or the Person in another Role are not offered', () => {
    const residence = (date: string) => event({ facts: facts({ type: 'residence', date }), roles: [role(P.jan, 'other')], role: 'other' });
    expect(mergeOffer(residence('1840'), residence('1850'), ...LIMITS).offered).toBe(false);
    expect(mergeOffer(event(), event({ facts: facts({ type: 'baptism' }) }), ...LIMITS).offered).toBe(false);
    expect(mergeOffer(event(), event({ role: 'witness' }), ...LIMITS).offered).toBe(false);
  });
});
