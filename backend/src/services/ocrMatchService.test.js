import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCanonicalDuelSubmission, compareCanonicalDuelScores } from './ocrMatchService.js';

test('buildCanonicalDuelSubmission converts player-relative scores into a global score', () => {
  const duel = {
    player1: 'p1',
    player2: 'p2'
  };

  const submission = buildCanonicalDuelSubmission(duel, 'p1', {
    myScore: '3',
    opponentScore: '4'
  });

  assert.equal(submission.score, '3-4');
  assert.equal(submission.declaredWinner, 'p2');
  assert.equal(submission.isDraw, false);
});

test('buildCanonicalDuelSubmission mirrors player2 input into the same global score', () => {
  const duel = {
    player1: 'p1',
    player2: 'p2'
  };

  const submission = buildCanonicalDuelSubmission(duel, 'p2', {
    myScore: '4',
    opponentScore: '3'
  });

  assert.equal(submission.score, '3-4');
  assert.equal(submission.declaredWinner, 'p2');
});

test('compareCanonicalDuelScores detects incompatible scores', () => {
  const comparison = compareCanonicalDuelScores(
    { score: '3-4', homePlayerId: 'p1', awayPlayerId: 'p2' },
    { score: '2-4', homePlayerId: 'p1', awayPlayerId: 'p2' }
  );

  assert.equal(comparison.sameScore, false);
  assert.equal(comparison.reason, 'Scores déclarés incompatibles');
});
