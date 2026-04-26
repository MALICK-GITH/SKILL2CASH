import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCommission } from '../src/services/commissionService.js';
import { shouldAutoApproveWithOcr } from '../src/services/ocrService.js';
import { badgeForUser, rankForUser } from '../src/services/rankService.js';
import { validateEfootballUsername } from '../src/utils/username.js';

test('commission is deducted from the total pot', () => {
  assert.deepEqual(calculateCommission(2000, 0.1), {
    commissionAmount: 200,
    winnerAmount: 1800
  });
});

test('rank grows with winnings and wins', () => {
  assert.equal(rankForUser({ wins: 0, totalEarnings: 0 }), 'Bronze');
  assert.equal(rankForUser({ wins: 22, totalEarnings: 76000 }), 'Gold');
  assert.equal(rankForUser({ wins: 110, totalEarnings: 10000 }), 'Legend');
});

test('badges reward dominant winning records', () => {
  assert.equal(badgeForUser({ wins: 30, losses: 8 }), 'Cash Reaper');
  assert.equal(badgeForUser({ wins: 12, losses: 11 }), 'Verified Skill');
});

test('OCR auto approval requires matching declarations and high confidence', () => {
  const player1 = { _id: 'p1', username: 'NeonStriker' };
  const player2 = { _id: 'p2', username: 'CashMaestro' };
  const duel = {
    resultPlayer1: { score: '3-1', declaredWinner: 'p1' },
    resultPlayer2: { score: '3:1', declaredWinner: 'p1' },
    ocrScorePlayer1: '3-1',
    ocrScorePlayer2: '3-1',
    ocrPlayersDetectedPlayer1: ['NeonStriker', 'CashMaestro'],
    ocrPlayersDetectedPlayer2: ['NeonStriker', 'CashMaestro'],
    ocrConfidencePlayer1: 91,
    ocrConfidencePlayer2: 88
  };

  assert.equal(shouldAutoApproveWithOcr({ duel, player1, player2 }).approved, true);
  duel.ocrConfidencePlayer2 = 84;
  assert.equal(shouldAutoApproveWithOcr({ duel, player1, player2 }).approved, false);
});

test('eFootball username is validated as the official SKILL2CASH username', () => {
  assert.equal(validateEfootballUsername('NeymarJr'), 'NeymarJr');
  assert.throws(() => validateEfootballUsername('bad name with spaces'));
});
