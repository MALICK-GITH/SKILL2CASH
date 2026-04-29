import express from 'express';
import { roomService } from '../services/roomService.js';
import { protect, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const rooms = await roomService.getAllRooms(req.query);
    res.json(rooms);
  } catch (error) {
    next(error);
  }
});

router.get('/featured', async (req, res, next) => {
  try {
    const rooms = await roomService.getFeaturedRooms();
    res.json(rooms);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const room = await roomService.getRoomById(req.params.id);
    res.json(room);
  } catch (error) {
    next(error);
  }
});

router.get('/:id/calculate', async (req, res, next) => {
  try {
    const calculation = await roomService.calculatePotentialWin(req.params.id);
    res.json(calculation);
  } catch (error) {
    next(error);
  }
});

router.post('/', protect, requireAdmin, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const room = await roomService.createRoom(req.body);
    res.status(201).json(room);
  } catch (error) {
    next(error);
  }
});

router.put('/:id', protect, requireAdmin, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const room = await roomService.updateRoom(req.params.id, req.body);
    res.json(room);
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', protect, requireAdmin, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    await roomService.deleteRoom(req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
