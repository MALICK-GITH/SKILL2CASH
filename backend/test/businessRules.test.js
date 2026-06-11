import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCommission } from '../src/services/commissionService.js';
import { shouldAutoApproveWithOcr } from '../src/services/ocrService.js';
import { OPEN_CHALLENGE_STATUSES, openChallengeFilter, isRequesterBlocked } from '../src/routes/challengeRoutes.js';
import { badgeForUser, rankForUser } from '../src/services/rankService.js';
import { buildTrustProfile, calculateTrustScore } from '../src/services/trustService.js';
import { validateEfootballUsername } from '../src/utils/username.js';

test('commission is deducted from the total pot', () => {
  assert.deepEqual(calculateCommission(2000, 0.1), {
    commissionAmount: 200,
    winnerAmount: 1800
  });
});

test('trust score does not over-reward legacy users without username lock state', () => {
  const locked = calculateTrustScore({
    wins: 20,
    losses: 2,
    reputation: 90,
    reportsCount: 0,
    usernameLocked: true
  });

  const legacy = calculateTrustScore({
    wins: 20,
    losses: 2,
    reputation: 90,
    reportsCount: 0
  });

  assert.equal(locked - legacy, 4);
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
  duel.ocrConfidencePlayer2 = 67;
  assert.equal(shouldAutoApproveWithOcr({ duel, player1, player2 }).approved, false);
});

test('eFootball username is validated as the official SKILL2CASH username', () => {
  assert.equal(validateEfootballUsername('NeymarJr'), 'NeymarJr');
  assert.throws(() => validateEfootballUsername('bad name with spaces'));
});

test('incoming and outgoing challenge lists only expose open statuses', () => {
  assert.deepEqual(OPEN_CHALLENGE_STATUSES, ['pending', 'counter_offer']);
  const fixedNow = new Date('2026-01-01T00:00:00.000Z');
  assert.deepEqual(openChallengeFilter('user-1', 'challenged', fixedNow), {
    challenged: 'user-1',
    status: { $in: ['pending', 'counter_offer'] },
    expiresAt: { $gt: fixedNow }
  });

  assert.deepEqual(openChallengeFilter('user-2', 'challenger', fixedNow), {
    challenger: 'user-2',
    status: { $in: ['pending', 'counter_offer'] },
    expiresAt: { $gt: fixedNow }
  });
});

test('blocked challenger lookup tolerates missing blockedUsers arrays', () => {
  assert.equal(isRequesterBlocked({}, 'user-1'), false);
  assert.equal(isRequesterBlocked({ blockedUsers: null }, 'user-1'), false);
  assert.equal(isRequesterBlocked({ blockedUsers: ['user-1'] }, 'user-1'), true);
});

test('trust score rewards reliable and consistent players', () => {
  const strongProfile = {
    wins: 42,
    losses: 4,
    currentStreak: 7,
    maxStreak: 11,
    totalEarnings: 180000,
    reputation: 96,
    reportsCount: 0,
    usernameLocked: true,
    minStake: 1000,
    maxStake: 25000
  };

  const riskyProfile = {
    wins: 3,
    losses: 11,
    currentStreak: 0,
    maxStreak: 1,
    totalEarnings: 1200,
    reputation: 38,
    reportsCount: 4,
    usernameLocked: false,
    minStake: 1000,
    maxStake: 5000
  };

  assert.ok(calculateTrustScore(strongProfile) > calculateTrustScore(riskyProfile));
  const trust = buildTrustProfile(strongProfile);
  assert.equal(trust.tierLabel, 'Référence');
  assert.ok(trust.recommendedStakeCap <= strongProfile.maxStake);
});
