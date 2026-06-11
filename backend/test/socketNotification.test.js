import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { User } from '../src/models/User.js';
import { configureSocket } from '../src/socket.js';
import { notifyUser } from '../src/services/notificationService.js';

function listenOnce(socket, event, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timeout en attendant ${event}`));
    }, timeoutMs);
    function onEvent(data) {
      clearTimeout(t);
      resolve(data);
    }
    socket.once(event, onEvent);
  });
}

test('Socket.IO: notifyUser émet notification:created vers la room utilisateur', async () => {
  assert.equal(
    env.mongoUri,
    'memory',
    'Ce test nécessite MONGO_URI=memory (défini via npm run test dans backend/)'
  );

  await connectDatabase();
  const httpServer = http.createServer();
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true }
  });
  configureSocket(io);

  try {
    const shortId = Math.random().toString(36).slice(2, 10);
    const passwordHash = await bcrypt.hash('TestPass!1', 10);
    const user = await User.create({
      username: `u${shortId}`,
      firstName: 'Test',
      lastName: 'Socket',
      efootballUsername: `e${shortId}`,
      email: `sock-${shortId}-${Date.now()}@test.local`,
      phone: `+22501${String(Date.now()).slice(-6)}${shortId}`,
      passwordHash,
      role: 'player'
    });

    const token = jwt.sign({ id: user._id, role: user.role }, env.jwtSecret, { expiresIn: '1h' });

    await new Promise((resolve, reject) => {
      httpServer.listen(0, '127.0.0.1', () => resolve());
      httpServer.on('error', reject);
    });
    const { port } = httpServer.address();

    const client = ioClient(`http://127.0.0.1:${port}`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false
    });

    await new Promise((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', (err) => reject(err));
    });

    const payloadPromise = listenOnce(client, 'notification:created');
    const publicPromise = listenOnce(client, 'new_notification');
    await notifyUser(user._id, 'auth:login', { testMeta: true });
    const [payload, publicN] = await Promise.all([payloadPromise, publicPromise]);

    assert.equal(payload.domainEvent, 'auth:login');
    assert.ok(payload.notification);
    assert.equal(String(payload.notification.user), String(user._id));
    assert.equal(payload.notification.type, 'system_alert');
    assert.equal(payload.notification.domainEvent, 'auth:login');
    assert.ok(typeof payload.ts === 'number');

    assert.equal(publicN.type, 'system_alert');
    assert.equal(publicN.message, payload.notification.body);
    assert.equal(publicN.read, false);

    client.disconnect();
  } finally {
    await new Promise((resolve) => {
      if (httpServer.listening) httpServer.close(() => resolve());
      else resolve();
    });
    await disconnectDatabase();
  }
});
