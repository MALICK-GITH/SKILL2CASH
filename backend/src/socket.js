import jwt from 'jsonwebtoken';
import { Duel } from './models/Duel.js';
import { User } from './models/User.js';
import { env } from './config/env.js';
import { setSocketServer } from './services/notificationService.js';

async function canAccessDuelRoom(socket, roomId) {
  if (!roomId || !socket.user?.id) return false;
  if (socket.user.role === 'admin') return true;

  const duel = await Duel.findOne({ roomId }).select('player1 player2').lean();
  if (!duel) return false;
  return String(duel.player1) === String(socket.user.id) || String(duel.player2) === String(socket.user.id);
}

export function configureSocket(io) {
  setSocketServer(io);
  const presence = new Map();

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentification requise'));
    try {
      socket.user = jwt.verify(token, env.jwtSecret);
      return next();
    } catch {
      return next(new Error('Session invalide'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user?.id;
    if (userId) {
      socket.join(`user:${userId}`);
      const count = (presence.get(userId) || 0) + 1;
      presence.set(userId, count);
      User.updateOne({ _id: userId }, { $set: { status: 'online' } }).catch(() => {});
    }

    socket.on('duel:join', async (roomId) => {
      if (await canAccessDuelRoom(socket, roomId)) {
        socket.join(`duel:${roomId}`);
      }
    });

    socket.on('duel:message', async ({ roomId, message }) => {
      if (!roomId || !message) return;
      if (!(await canAccessDuelRoom(socket, roomId))) return;
      io.to(`duel:${roomId}`).emit('duel:message', {
        userId: socket.user?.id || 'guest',
        message: String(message).slice(0, 500),
        sentAt: new Date().toISOString()
      });
    });

    socket.on('disconnect', () => {
      if (!userId) return;
      const count = Math.max((presence.get(userId) || 1) - 1, 0);
      if (count === 0) {
        presence.delete(userId);
        User.updateOne({ _id: userId, status: 'online' }, { $set: { status: 'offline' } }).catch(() => {});
        return;
      }
      presence.set(userId, count);
    });
  });
}
