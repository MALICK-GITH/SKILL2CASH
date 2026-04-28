import express from 'express';
import { protect } from '../middleware/auth.js';
import { Notification } from '../models/Notification.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const notificationRouter = express.Router();

notificationRouter.use(protect);

notificationRouter.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
  const unreadOnly = req.query.unread === 'true';
  const filter = { user: req.user._id };
  if (unreadOnly) filter.isRead = false;

  const [notifications, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).limit(limit),
    Notification.countDocuments({ user: req.user._id, isRead: false })
  ]);

  res.json({ notifications, unreadCount });
}));

notificationRouter.patch('/:id/read', asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { $set: { isRead: true, readAt: new Date() } },
    { new: true }
  );

  if (!notification) throw new AppError('Notification introuvable', 404);
  res.json({ notification });
}));

async function markAllNotificationsAsRead(req, res) {
  await Notification.updateMany(
    { user: req.user._id, isRead: false },
    { $set: { isRead: true, readAt: new Date() } }
  );
  res.json({ ok: true });
}

notificationRouter.all('/read-all', asyncHandler(markAllNotificationsAsRead));
