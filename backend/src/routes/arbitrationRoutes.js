import express from 'express';
import { arbitrationService } from '../services/arbitrationService.js';
import { protect, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const arbitrations = await arbitrationService.getAllArbitrations(req.query);
    res.json(arbitrations);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const arbitration = await arbitrationService.getArbitrationById(req.params.id);
    res.json(arbitration);
  } catch (error) {
    next(error);
  }
});

router.get('/duel/:duelId', async (req, res, next) => {
  try {
    const arbitration = await arbitrationService.getArbitrationByDuel(req.params.duelId);
    res.json(arbitration);
  } catch (error) {
    next(error);
  }
});

router.post('/', protect, async (req, res, next) => {
  try {
    const { duelId, disputeReason } = req.body;
    const arbitration = await arbitrationService.createArbitration(duelId, disputeReason);
    res.status(201).json(arbitration);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/assign', protect, requireAdmin, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const arbitration = await arbitrationService.assignArbitrator(req.params.id, req.user._id);
    res.json(arbitration);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/challenger-evidence', protect, async (req, res, next) => {
  try {
    const arbitration = await arbitrationService.getArbitrationById(req.params.id);
    if (arbitration.challenger._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }
    const updated = await arbitrationService.submitChallengerEvidence(req.params.id, req.body);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/opponent-evidence', protect, async (req, res, next) => {
  try {
    const arbitration = await arbitrationService.getArbitrationById(req.params.id);
    if (arbitration.opponent._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }
    const updated = await arbitrationService.submitOpponentEvidence(req.params.id, req.body);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/resolve', protect, requireAdmin, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const { decision, decisionReason } = req.body;
    const arbitration = await arbitrationService.resolveArbitration(req.params.id, decision, decisionReason, req.user._id);
    res.json(arbitration);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/escalate', protect, requireAdmin, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const arbitration = await arbitrationService.escalateArbitration(req.params.id);
    res.json(arbitration);
  } catch (error) {
    next(error);
  }
});

export default router;
