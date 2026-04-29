import express from 'express';
import { chatMessageService } from '../services/chatMessageService.js';
import { protect, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/challenge/:challengeId', async (req, res, next) => {
  try {
    const messages = await chatMessageService.getMessagesByChallenge(req.params.challengeId, req.query);
    res.json(messages);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const message = await chatMessageService.getMessageById(req.params.id);
    res.json(message);
  } catch (error) {
    next(error);
  }
});

router.post('/challenge/:challengeId', protect, async (req, res, next) => {
  try {
    const { message, isSystem, metadata } = req.body;
    const chatMessage = await chatMessageService.createMessage(req.params.challengeId, req.user._id, { message, isSystem, metadata });
    res.status(201).json(chatMessage);
  } catch (error) {
    next(error);
  }
});

router.post('/challenge/:challengeId/system', protect, requireAdmin, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const { message, metadata } = req.body;
    const chatMessage = await chatMessageService.createSystemMessage(req.params.challengeId, message, metadata);
    res.status(201).json(chatMessage);
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', protect, async (req, res, next) => {
  try {
    await chatMessageService.deleteMessage(req.params.id, req.user._id, req.user.role);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get('/challenge/:challengeId/unread', protect, async (req, res, next) => {
  try {
    const count = await chatMessageService.getUnreadCount(req.params.challengeId, req.user._id);
    res.json({ count });
  } catch (error) {
    next(error);
  }
});

router.post('/challenge/:challengeId/read', protect, async (req, res, next) => {
  try {
    const result = await chatMessageService.markAsRead(req.params.challengeId, req.user._id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
