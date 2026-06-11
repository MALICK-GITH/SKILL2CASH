import express from 'express';
import mongoose from 'mongoose';
import { protect, requireAdmin } from '../middleware/auth.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { createNotification, emitToUser, serializePublicNotification } from '../services/notificationService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const notificationRouter = express.Router();

notificationRouter.use(protect);

notificationRouter.get('/unread-count', asyncHandler(async (req, res) => {
  const count = await Notification.countDocuments({
    user: req.user._id,
    isRead: false,
    archivedAt: null
  });
  res.json({ count });
}));

notificationRouter.get('/stats', asyncHandler(async (req, res) => {
  const baseFilter = { user: req.user._id };
  const [unreadCount, archivedCount, totalCount] = await Promise.all([
    Notification.countDocuments({ ...baseFilter, isRead: false, archivedAt: null }),
    Notification.countDocuments({ ...baseFilter, archivedAt: { $ne: null } }),
    Notification.countDocuments(baseFilter)
  ]);

  res.json({ unreadCount, archivedCount, totalCount });
}));

notificationRouter.get('/', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 50)));
  const unreadOnly = req.query.unread === 'true';
  const archived = req.query.archived === 'true';
  const skip = (page - 1) * limit;
  const filter = { user: req.user._id, archivedAt: archived ? { $ne: null } : null };
  if (unreadOnly) filter.isRead = false;

  const [rows, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: req.user._id, isRead: false, archivedAt: null })
  ]);

  const notifications = rows.map((doc) => ({
    ...doc,
    userId: doc.user,
    message: doc.body || '',
    data: doc.metadata || {},
    read: Boolean(doc.isRead)
  }));

  res.json({ notifications, total, page, limit, unreadCount });
}));

notificationRouter.post('/admin', requireAdmin, asyncHandler(async (req, res) => {
  const { userId, type, title, message, data, priority, link } = req.body || {};
  if (!userId || !mongoose.isObjectIdOrHexString(String(userId))) {
    throw new AppError('userId MongoDB invalide', 400);
  }
  if (!title || !message) {
    throw new AppError('title et message sont requis', 400);
  }
  const target = await User.findById(userId).select('_id');
  if (!target) throw new AppError('Utilisateur introuvable', 404);
  const doc = await createNotification(null, {
    userId,
    type: type || 'admin_alert',
    title: String(title).slice(0, 200),
    message: String(message).slice(0, 2000),
    data: data && typeof data === 'object' ? data : {},
    priority: priority || 'high',
    link: link ? String(link).slice(0, 500) : ''
  });
  res.status(201).json({ notification: serializePublicNotification(doc) });
}));

notificationRouter.patch(
  '/read-all',
  asyncHandler(async (req, res) => {
    await Notification.updateMany(
      { user: req.user._id, isRead: false, archivedAt: null },
      { $set: { isRead: true, readAt: new Date() } }
    );
    emitToUser(req.user._id, 'notification:read_all', { userId: String(req.user._id), unreadCount: 0, ts: Date.now() });
    res.json({ ok: true });
  })
);

notificationRouter.patch('/:id/read', asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id, archivedAt: null },
    { $set: { isRead: true, readAt: new Date() } },
    { new: true }
  );

  if (!notification) throw new AppError('Notification introuvable', 404);

  const unreadCount = await Notification.countDocuments({
    user: req.user._id,
    isRead: false,
    archivedAt: null
  });
  emitToUser(req.user._id, 'notification:read', {
    userId: String(req.user._id),
    notification: notification.toObject(),
    unreadCount,
    ts: Date.now()
  });

  res.json({ notification: notification.toObject() });
}));

notificationRouter.patch('/:id/archive', asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id, archivedAt: null },
    { $set: { archivedAt: new Date() } },
    { new: true }
  );

  if (!notification) throw new AppError('Notification introuvable', 404);
  res.json({ notification: notification.toObject() });
}));

notificationRouter.patch('/:id/unarchive', asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id, archivedAt: { $ne: null } },
    { $set: { archivedAt: null } },
    { new: true }
  );

  if (!notification) throw new AppError('Notification introuvable', 404);
  res.json({ notification: notification.toObject() });
}));

notificationRouter.delete('/clear-all', asyncHandler(async (req, res) => {
  const result = await Notification.deleteMany({ user: req.user._id, archivedAt: null });
  const deletedCount = Number(result?.deletedCount || 0);
  emitToUser(req.user._id, 'notification:cleared', { userId: String(req.user._id), unreadCount: 0, deletedCount, ts: Date.now() });
  res.json({ ok: true, unreadCount: 0, deletedCount });
}));

notificationRouter.delete('/:id', asyncHandler(async (req, res) => {
  const result = await Notification.deleteOne({ _id: req.params.id, user: req.user._id });
  if (!result.deletedCount) throw new AppError('Notification introuvable', 404);
  const unreadCount = await Notification.countDocuments({
    user: req.user._id,
    isRead: false,
    archivedAt: null
  });
  emitToUser(req.user._id, 'notification:deleted', { userId: String(req.user._id), id: req.params.id, unreadCount, ts: Date.now() });
  res.json({ ok: true, unreadCount });
}));
