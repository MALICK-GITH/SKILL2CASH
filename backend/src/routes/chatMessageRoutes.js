import express from 'express';
import { chatMessageService } from '../services/chatMessageService.js';
import { protect, requireAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

router.get('/challenge/:challengeId', async (req, res, next) => {
  try {
    const messages = await chatMessageService.getMessagesByChallenge(req.params.challengeId, req.user._id, req.user.role, req.query);
    res.json(messages);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const message = await chatMessageService.getMessageById(req.params.id, req.user._id, req.user.role);
    res.json(message);
  } catch (error) {
    next(error);
  }
});

router.post('/challenge/:challengeId', async (req, res, next) => {
  try {
    const { message, isSystem, metadata } = req.body;
    const chatMessage = await chatMessageService.createMessage(req.params.challengeId, req.user._id, { message, isSystem, metadata });
    res.status(201).json(chatMessage);
  } catch (error) {
    next(error);
  }
});

router.post('/challenge/:challengeId/system', requireAdmin, async (req, res, next) => {
  try {
    const { message, metadata } = req.body;
    const chatMessage = await chatMessageService.createSystemMessage(req.params.challengeId, message, metadata, req.user._id);
    res.status(201).json(chatMessage);
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await chatMessageService.deleteMessage(req.params.id, req.user._id, req.user.role);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get('/challenge/:challengeId/unread', async (req, res, next) => {
  try {
    const count = await chatMessageService.getUnreadCount(req.params.challengeId, req.user._id);
    res.json({ count });
  } catch (error) {
    next(error);
  }
});

router.post('/challenge/:challengeId/read', async (req, res, next) => {
  try {
    const result = await chatMessageService.markAsRead(req.params.challengeId, req.user._id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
