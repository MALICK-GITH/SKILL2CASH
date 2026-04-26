import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAmountCandidates, normalizeDigits, normalizeScore } from './imageProcessing.js';

test('normalizeDigits strips separators from amounts', () => {
  assert.equal(normalizeDigits('5 000'), '5000');
  assert.equal(normalizeDigits('12,500 CFA'), '12500');
});

test('extractAmountCandidates finds visible payment amounts', () => {
  const amounts = extractAmountCandidates('Paiement recu 5 000 CFA reference 128944');
  assert.deepEqual(amounts, ['5000']);
});

test('normalizeScore still parses classic scoreboard formats', () => {
  assert.equal(normalizeScore('Score final 4:2'), '4-2');
});
