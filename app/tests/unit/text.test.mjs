import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalize } from '../../src/text.js';

test('normalize folds case, diacritics and dashes', () => {
  assert.equal(normalize('Žďár nad Sázavou'), 'zdar nad sazavou');
  assert.equal(normalize('ŽĎÁR'), 'zdar');
  assert.equal(normalize('Brandýs nad Labem - Stará Boleslav'), 'brandys nad labem stara boleslav');
  assert.equal(normalize('  Ústí   nad Orlicí '), 'usti nad orlici');
  assert.equal(normalize('Frýdek-Místek'), 'frydek mistek');
  assert.equal(normalize('Řečany – Ůvaly'), 'recany uvaly');
});
