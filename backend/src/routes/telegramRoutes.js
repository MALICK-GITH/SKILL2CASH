import express from 'express';
import { telegramService } from '../services/telegramService.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.post('/verify', async (req, res, next) => {
  try {
    const { initData } = req.body;
    if (!initData) {
      return res.status(400).json({ message: 'initData is required' });
    }

    const telegramData = telegramService.verifyTelegramWebAppData(initData);
    const result = await telegramService.handleTelegramAuth(telegramData);

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const { identifier } = req.body;
    if (!identifier) {
      return res.status(400).json({ message: 'Identifier (username or phone) is required' });
    }

    const result = await telegramService.generateAndSendPassword(identifier);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/link', protect, async (req, res, next) => {
  try {
    const { initData } = req.body;
    if (!initData) {
      return res.status(400).json({ message: 'initData is required' });
    }

    const telegramData = telegramService.verifyTelegramWebAppData(initData);
    const user = await telegramService.linkTelegramAccount(req.user._id, telegramData);
    res.json(user);
  } catch (error) {
    next(error);
  }
});

router.post('/unlink', protect, async (req, res, next) => {
  try {
    const user = await telegramService.unlinkTelegramAccount(req.user._id);
    res.json(user);
  } catch (error) {
    next(error);
  }
});

export default router;
