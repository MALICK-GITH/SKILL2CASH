import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { Duel } from '../src/models/Duel.js';
import { User } from '../src/models/User.js';
import { configureSocket } from '../src/socket.js';

function makeFakeScreenshot() {
  return `data:image/png;base64,${'A'.repeat(20_000)}`;
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function onceWithTimeout(socket, event, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout en attendant ${event}`));
    }, timeoutMs);
    function handler(payload) {
      clearTimeout(timer);
      resolve(payload);
    }
    socket.once(event, handler);
  });
}

async function waitFor(predicate, timeoutMs = 30_000, intervalMs = 250) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Condition non satisfaite apres ${timeoutMs}ms`);
}

async function createPlayer(prefix) {
  const shortId = Math.random().toString(36).slice(2, 9);
  const passwordHash = await bcrypt.hash('TestPass!1', 10);
  return User.create({
    username: `${prefix}${shortId}`,
    firstName: 'Test',
    lastName: 'E2E',
    efootballUsername: `ef${prefix}${shortId}`,
    email: `${prefix}-${shortId}-${Date.now()}@test.local`,
    phone: `+22501${String(Date.now()).slice(-6)}${shortId}`,
    passwordHash,
    role: 'player'
  });
}

test('E2E preuve duel: upload immediat + synchro socket + OCR async vers review', async () => {
  assert.equal(env.mongoUri, 'memory', 'Ce test nécessite MONGO_URI=memory');
  await connectDatabase();

  const app = createApp();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { cors: { origin: true, credentials: true } });
  configureSocket(io);

  try {
    process.env.SKILL2CASH_DISABLE_DUEL_OCR = '1';
    const [playerA, playerB] = await Promise.all([createPlayer('ea'), createPlayer('eb')]);
    const duel = await Duel.create({
      player1: playerA._id,
      player2: playerB._id,
      amount: 1000,
      potTotal: 2000,
      commissionRate: 0.1,
      commissionAmount: 200,
      winnerAmount: 1800,
      status: 'active',
      roomId: `room-${Date.now().toString(36)}`
    });

    const tokenA = jwt.sign({ id: playerA._id, role: playerA.role }, env.jwtSecret, { expiresIn: '1h' });
    const tokenB = jwt.sign({ id: playerB._id, role: playerB.role }, env.jwtSecret, { expiresIn: '1h' });

    await new Promise((resolve, reject) => {
      httpServer.listen(0, '127.0.0.1', () => resolve());
      httpServer.on('error', reject);
    });
    const { port } = httpServer.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    const socketA = ioClient(baseUrl, {
      auth: { token: tokenA },
      transports: ['websocket'],
      reconnection: false
    });
    const socketB = ioClient(baseUrl, {
      auth: { token: tokenB },
      transports: ['websocket'],
      reconnection: false
    });

    await Promise.all([
      new Promise((resolve, reject) => {
        socketA.once('connect', resolve);
        socketA.once('connect_error', reject);
      }),
      new Promise((resolve, reject) => {
        socketB.once('connect', resolve);
        socketB.once('connect_error', reject);
      })
    ]);

    socketA.emit('duel:join', duel.roomId);
    socketB.emit('duel:join', duel.roomId);

    const playerBProofReceived = onceWithTimeout(socketB, 'duel:proof_received');
    const t1 = Date.now();
    const submitA = await fetch(`${baseUrl}/api/duels/${duel._id}/proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearer(tokenA) },
      body: JSON.stringify({
        score: '2-1',
        declaredWinner: String(playerA._id),
        screenshot: makeFakeScreenshot()
      })
    });
    const elapsedA = Date.now() - t1;
    assert.equal(submitA.status, 200);
    assert.ok(elapsedA < 2000, `Upload A doit etre immediat (elapsed=${elapsedA}ms)`);
    await playerBProofReceived;

    const storedAfterA = await Duel.findById(duel._id).lean();
    assert.equal(storedAfterA.status, 'waiting_player2_proof');
    assert.ok(storedAfterA.resultPlayer1?.screenshot);
    assert.equal(storedAfterA.resultPlayer2, null);

    const analysisStartedA = onceWithTimeout(socketA, 'duel:analysis_started', 12_000);
    const analysisStartedB = onceWithTimeout(socketB, 'duel:analysis_started', 12_000);
    const t2 = Date.now();
    const submitB = await fetch(`${baseUrl}/api/duels/${duel._id}/proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearer(tokenB) },
      body: JSON.stringify({
        score: '2-1',
        declaredWinner: String(playerB._id),
        screenshot: makeFakeScreenshot()
      })
    });
    const elapsedB = Date.now() - t2;
    assert.equal(submitB.status, 200);
    assert.ok(elapsedB < 2000, `Upload B doit etre immediat (elapsed=${elapsedB}ms)`);
    await Promise.all([analysisStartedA, analysisStartedB]);

    const immediateAfterB = await Duel.findById(duel._id).lean();
    assert.equal(immediateAfterB.status, 'analyzing');
    assert.equal(immediateAfterB.autoValidationStatus, 'pending');

    const finalized = await waitFor(async () => {
      const current = await Duel.findById(duel._id).lean();
      return ['dispute', 'finished'].includes(current?.status) ? current : null;
    }, 35_000, 500);

    // On force une incohérence de déclaration pour garantir l'absence de paiement automatique.
    assert.equal(finalized.status, 'dispute');
    assert.ok(['manual_review', 'failed'].includes(finalized.autoValidationStatus));
    assert.equal(finalized.winner, null);
    assert.equal(finalized.loser, null);

    socketA.disconnect();
    socketB.disconnect();
  } finally {
    delete process.env.SKILL2CASH_DISABLE_DUEL_OCR;
    await new Promise((resolve) => {
      if (httpServer.listening) httpServer.close(() => resolve());
      else resolve();
    });
    await disconnectDatabase();
  }
});
