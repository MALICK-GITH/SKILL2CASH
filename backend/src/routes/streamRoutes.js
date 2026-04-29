import express from 'express';
import { streamService } from '../services/streamService.js';
import { protect, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const streams = await streamService.getAllStreams(req.query);
    res.json(streams);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const stream = await streamService.getStreamById(req.params.id);
    res.json(stream);
  } catch (error) {
    next(error);
  }
});

router.get('/duel/:duelId', async (req, res, next) => {
  try {
    const stream = await streamService.getStreamByDuel(req.params.duelId);
    res.json(stream);
  } catch (error) {
    next(error);
  }
});

router.post('/', protect, requireAdmin, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const stream = await streamService.createStream(req.body.duel, req.body);
    res.status(201).json(stream);
  } catch (error) {
    next(error);
  }
});

router.put('/:id', protect, requireAdmin, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const stream = await streamService.updateStream(req.params.id, req.body);
    res.json(stream);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/start', protect, requireAdmin, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const stream = await streamService.startStream(req.params.id);
    res.json(stream);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/end', protect, requireAdmin, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const stream = await streamService.endStream(req.params.id, req.body.vodUrl);
    res.json(stream);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/cancel', protect, requireAdmin, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const stream = await streamService.cancelStream(req.params.id);
    res.json(stream);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/peak-viewers', protect, async (req, res, next) => {
  try {
    const { viewers } = req.body;
    const stream = await streamService.updatePeakViewers(req.params.id, viewers);
    res.json(stream);
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', protect, requireAdmin, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    await streamService.deleteStream(req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
