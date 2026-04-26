import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPlayersFromText, extractScoreCandidates, normalizeScore, shouldAutoApproveWithOcr } from './ocrService.js';

test('normalizeScore accepts flexible score formats', () => {
  assert.equal(normalizeScore('3 - 1'), '3-1');
  assert.equal(normalizeScore('03:01'), '3-1');
  assert.equal(normalizeScore('score 2/0'), '2-0');
});

test('extractScoreCandidates returns the most likely visible scores', () => {
  const scores = extractScoreCandidates('FINAL 3-1 / score 2-0 / result 4-2');
  assert.deepEqual(scores, ['3-1', '2-0', '4-2']);
});

test('detectPlayersFromText matches compacted and spaced usernames', () => {
  const players = [
    { username: 'SOLITAIREONE' },
    { username: 'MALICKPRO' }
  ];

  const detected = detectPlayersFromText('Solitaire One 3-1 Malick Pro', players);
  assert.deepEqual(detected, ['SOLITAIREONE', 'MALICKPRO']);
});

test('shouldAutoApproveWithOcr requires matching declarations and OCR evidence', () => {
  const duel = {
    resultPlayer1: { score: '3-1', declaredWinner: 'player-1' },
    resultPlayer2: { score: '3-1', declaredWinner: 'player-1' },
    ocrScorePlayer1: '3-1',
    ocrScorePlayer2: '3-1',
    ocrPlayersDetectedPlayer1: ['PLAYER ONE', 'PLAYER TWO'],
    ocrPlayersDetectedPlayer2: ['PLAYER ONE', 'PLAYER TWO'],
    ocrConfidencePlayer1: 92,
    ocrConfidencePlayer2: 89
  };

  const player1 = { _id: 'player-1', username: 'PLAYER ONE' };
  const player2 = { _id: 'player-2', username: 'PLAYER TWO' };

  const validation = shouldAutoApproveWithOcr({ duel, player1, player2 });
  assert.equal(validation.approved, true);
});
