// How the pickers label Persons from the Tree.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { personText } from '../../src/pickers.js';

test('a Person found in the Tree is labelled with the year of birth, or the birth date as known', () => {
  assert.equal(personText('Josef', 'Dvořák', '1805-03-02'), 'Josef Dvořák (* 1805)');
  assert.equal(personText('Josef', 'Dvořák', '1805?'), 'Josef Dvořák (* 1805)');
  assert.equal(personText('Josef', 'Dvořák', '../1805'), 'Josef Dvořák (* ../1805)');
  assert.equal(personText('Josef', 'Dvořák', '[1804,1805]'), 'Josef Dvořák (* [1804,1805])');
  assert.equal(personText('', 'Dvořák', null), 'Dvořák');
});
