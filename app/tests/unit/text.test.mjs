import assert from 'node:assert/strict';
import { test } from 'node:test';
import './shared-loader.mjs';
import { normalize } from '../../src/text.js';

// After shared-loader.mjs: TypeScript.
const { foldForSearch } = await import('../../../shared/src/text.js');

test('normalize folds case, diacritics and dashes', () => {
  assert.equal(normalize('Žďár nad Sázavou'), 'zdar nad sazavou');
  assert.equal(normalize('ŽĎÁR'), 'zdar');
  assert.equal(normalize('Brandýs nad Labem - Stará Boleslav'), 'brandys nad labem stara boleslav');
  assert.equal(normalize('  Ústí   nad Orlicí '), 'usti nad orlici');
  assert.equal(normalize('Frýdek-Místek'), 'frydek mistek');
  assert.equal(normalize('Řečany – Ůvaly'), 'recany uvaly');
});

test("normalize folds letters the way the server's search does (shared foldForSearch)", () => {
  const words = [
    'Žďár nad Sázavou',
    'Straße',
    'STRASSE',
    'Łódź',
    'Æbeltoft',
    'Œuvre',
    'Ørsted',
    'Đakovo',
    'Þórshöfn',
    'Ħamrun',
    'İzmir',
    'ıspanak',
    'Ĳsselmeer',
    'ſchön',
    'ﬁlip',
    'Mährisch Ostrau',
    'Nový Jičín',
    'Olomouc',
    'Český Krumlov',
    'Ödön Lechner',
    'Ångström',
    'Zürich',
  ];
  for (const word of words) assert.equal(normalize(word), foldForSearch(word), word);
});
