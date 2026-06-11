import express from 'express';
import { gameService } from '../services/gameService.js';
import { protect, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const games = await gameService.getAllGames(req.query);
    res.json(games);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const game = await gameService.getGameById(req.params.id);
    res.json(game);
  } catch (error) {
    next(error);
  }
});

router.post('/', protect, requireAdmin, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const game = await gameService.createGame(req.body);
    res.status(201).json(game);
  } catch (error) {
    next(error);
  }
});

router.put('/:id', protect, requireAdmin, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const game = await gameService.updateGame(req.params.id, req.body);
    res.json(game);
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', protect, requireAdmin, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    await gameService.deleteGame(req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
