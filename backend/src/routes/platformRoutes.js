import express from 'express';
import { platformService } from '../services/platformService.js';
import { protect, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const platforms = await platformService.getAllPlatforms(req.query);
    res.json(platforms);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const platform = await platformService.getPlatformById(req.params.id);
    res.json(platform);
  } catch (error) {
    next(error);
  }
});

router.post('/', protect, requireAdmin, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const platform = await platformService.createPlatform(req.body);
    res.status(201).json(platform);
  } catch (error) {
    next(error);
  }
});

router.put('/:id', protect, requireAdmin, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const platform = await platformService.updatePlatform(req.params.id, req.body);
    res.json(platform);
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', protect, requireAdmin, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    await platformService.deletePlatform(req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
