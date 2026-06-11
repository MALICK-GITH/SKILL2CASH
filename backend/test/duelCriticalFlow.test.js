import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';
import { Duel } from '../src/models/Duel.js';
import { Challenge } from '../src/models/Challenge.js';
import { Notification } from '../src/models/Notification.js';
import { finishDuel } from '../src/services/duelService.js';
import { markExpiredOpenChallenges } from '../src/routes/challengeRoutes.js';

async function createPlayer(prefix) {
  const shortId = Math.random().toString(36).slice(2, 9);
  const passwordHash = await bcrypt.hash('TestPass!1', 10);
  return User.create({
    username: `${prefix}${shortId}`,
    firstName: 'Test',
    lastName: 'Player',
    efootballUsername: `ef${prefix}${shortId}`,
    email: `${prefix}-${shortId}-${Date.now()}@test.local`,
    phone: `+22501${String(Date.now()).slice(-6)}${shortId}`,
    passwordHash,
    role: 'player'
  });
}

test('finishDuel gère un match nul et rembourse les deux mises', async () => {
  assert.equal(env.mongoUri, 'memory', 'Ce test nécessite MONGO_URI=memory');
  await connectDatabase();
  try {
    const [player1, player2] = await Promise.all([createPlayer('p1'), createPlayer('p2')]);
    await Wallet.create([
      {
        user: player1._id,
        balanceAvailable: 0,
        balanceLocked: 1000,
        balanceTotal: 1000
      },
      {
        user: player2._id,
        balanceAvailable: 0,
        balanceLocked: 1000,
        balanceTotal: 1000
      }
    ]);

    const duel = await Duel.create({
      player1: player1._id,
      player2: player2._id,
      amount: 1000,
      potTotal: 2000,
      commissionRate: 0.1,
      commissionAmount: 200,
      winnerAmount: 1800,
      status: 'active',
      roomId: `room-${Date.now().toString(36)}`
    });

    const finished = await finishDuel(duel._id, 'draw');
    const [wallet1, wallet2, storedDuel] = await Promise.all([
      Wallet.findOne({ user: player1._id }),
      Wallet.findOne({ user: player2._id }),
      Duel.findById(duel._id)
    ]);

    assert.equal(finished.status, 'finished');
    assert.equal(storedDuel.isDraw, true);
    assert.equal(storedDuel.winner, null);
    assert.equal(storedDuel.loser, null);
    assert.equal(wallet1.balanceAvailable, 1000);
    assert.equal(wallet1.balanceLocked, 0);
    assert.equal(wallet2.balanceAvailable, 1000);
    assert.equal(wallet2.balanceLocked, 0);
  } finally {
    await disconnectDatabase();
  }
});

test('markExpiredOpenChallenges bascule les défis expirés et notifie les joueurs', async () => {
  assert.equal(env.mongoUri, 'memory', 'Ce test nécessite MONGO_URI=memory');
  await connectDatabase();
  try {
    const [challenger, challenged] = await Promise.all([createPlayer('c1'), createPlayer('c2')]);
    const now = new Date('2026-01-01T12:00:00.000Z');
    const challenge = await Challenge.create({
      challenger: challenger._id,
      challenged: challenged._id,
      amount: 1200,
      matchType: 'eFootball 1v1',
      rules: 'Règles standard',
      roomId: `challenge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      expiresAt: new Date('2026-01-01T11:59:00.000Z')
    });

    const count = await markExpiredOpenChallenges(now);
    const [stored, notifs] = await Promise.all([
      Challenge.findById(challenge._id),
      Notification.find({ domainEvent: 'challenge:expired', 'metadata.challengeId': challenge._id })
    ]);

    assert.equal(count, 1);
    assert.equal(stored.status, 'expired');
    assert.equal(notifs.length, 2);
  } finally {
    await disconnectDatabase();
  }
});
