import jwt from 'jsonwebtoken';
import { Duel } from './models/Duel.js';
import { Notification } from './models/Notification.js';
import { User } from './models/User.js';
import { env } from './config/env.js';
import { setSocketServer, userSocketRoom } from './services/notificationService.js';

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
    const presenceKey = userId != null ? String(userId) : '';
    if (userId) {
      socket.join(userSocketRoom(userId));
      const count = (presence.get(presenceKey) || 0) + 1;
      presence.set(presenceKey, count);
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

    /** Sync léger des notifications après reconnexion (compteur + derniers items). */
    socket.on('notifications:sync', async (ack) => {
      if (typeof ack !== 'function' || !userId) return;
      try {
        const [unreadCount, recent] = await Promise.all([
          Notification.countDocuments({ user: userId, isRead: false }),
          Notification.find({ user: userId })
            .sort({ createdAt: -1 })
            .limit(8)
            .select('type domainEvent title body isRead createdAt metadata link priority')
            .lean()
        ]);
        ack({ ok: true, unreadCount, recent, ts: Date.now() });
      } catch {
        ack({ ok: false, ts: Date.now() });
      }
    });

    socket.on('disconnect', () => {
      if (!userId) return;
      const count = Math.max((presence.get(presenceKey) || 1) - 1, 0);
      if (count === 0) {
        presence.delete(presenceKey);
        User.updateOne({ _id: userId, status: 'online' }, { $set: { status: 'offline' } }).catch(() => {});
        return;
      }
      presence.set(presenceKey, count);
    });
  });
}
