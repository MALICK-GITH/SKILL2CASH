import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { Duel } from '../src/models/Duel.js';
import { User } from '../src/models/User.js';
import { submitResult } from '../src/services/duelService.js';

function makeFakeScreenshot() {
  return `data:image/png;base64,${'A'.repeat(20_000)}`;
}

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

test('submitResult repond vite et lance l OCR en arriere-plan', async () => {
  assert.equal(env.mongoUri, 'memory', 'Ce test nécessite MONGO_URI=memory');
  await connectDatabase();
  try {
    const [player1, player2] = await Promise.all([createPlayer('ap1'), createPlayer('ap2')]);
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

    await submitResult(duel._id, player1._id, {
      score: '2-1',
      declaredWinner: player1._id,
      screenshot: makeFakeScreenshot()
    });

    const start = Date.now();
    const returned = await submitResult(duel._id, player2._id, {
      score: '2-1',
      declaredWinner: player1._id,
      screenshot: makeFakeScreenshot()
    });
    const elapsedMs = Date.now() - start;

    assert.equal(returned.status, 'analyzing');
    assert.equal(returned.autoValidationStatus, 'pending');
    assert.ok(elapsedMs < 1500, `La soumission ne doit pas attendre l OCR (elapsed=${elapsedMs}ms)`);
  } finally {
    await disconnectDatabase();
  }
});
