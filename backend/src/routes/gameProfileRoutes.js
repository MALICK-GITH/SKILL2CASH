import express from 'express';
import { gameProfileService } from '../services/gameProfileService.js';
import { protect, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/my-profiles', protect, async (req, res, next) => {
  try {
    const profiles = await gameProfileService.getUserGameProfiles(req.user._id, req.query);
    res.json(profiles);
  } catch (error) {
    next(error);
  }
});

router.get('/search', async (req, res, next) => {
  try {
    const { gamertag } = req.query;
    if (!gamertag) {
      return res.status(400).json({ message: 'Gamertag is required' });
    }
    const profiles = await gameProfileService.searchByGamertag(gamertag);
    res.json(profiles);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const profile = await gameProfileService.getGameProfileById(req.params.id);
    res.json(profile);
  } catch (error) {
    next(error);
  }
});

router.post('/', protect, async (req, res, next) => {
  try {
    const profile = await gameProfileService.createGameProfile(req.user._id, req.body);
    res.status(201).json(profile);
  } catch (error) {
    next(error);
  }
});

router.put('/:id', protect, async (req, res, next) => {
  try {
    const profile = await gameProfileService.getGameProfileById(req.params.id);
    if (profile.user._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const updatedProfile = await gameProfileService.updateGameProfile(req.params.id, req.body);
    res.json(updatedProfile);
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', protect, async (req, res, next) => {
  try {
    const profile = await gameProfileService.getGameProfileById(req.params.id);
    if (profile.user._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }
    await gameProfileService.deleteGameProfile(req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.post('/:id/verify', protect, requireAdmin, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const profile = await gameProfileService.verifyGameProfile(req.params.id, req.user._id);
    res.json(profile);
  } catch (error) {
    next(error);
  }
});

export default router;
