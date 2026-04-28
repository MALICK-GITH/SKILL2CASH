import express from 'express';
import { Duel } from '../models/Duel.js';
import { protect } from '../middleware/auth.js';
import { requireFields } from '../middleware/validate.js';
import { submitResult } from '../services/duelService.js';
import { notifyAdmins, notifyRoom } from '../services/notificationService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const duelRouter = express.Router();
duelRouter.use(protect);

duelRouter.get('/', asyncHandler(async (req, res) => {
  const filter = { $or: [{ player1: req.user._id }, { player2: req.user._id }] };
  const duels = await Duel.find(filter).populate('player1 player2 winner loser', 'username efootballUsername avatar country rank').sort({ createdAt: -1 });
  res.json({ duels });
}));

duelRouter.get('/:id', asyncHandler(async (req, res) => {
  const duel = await Duel.findById(req.params.id).populate('player1 player2 winner loser', 'username efootballUsername avatar country rank');
  if (!duel) throw new AppError('Duel non trouvé', 404);
  if (String(duel.player1._id) !== String(req.user._id) && String(duel.player2._id) !== String(req.user._id) && req.user.role !== 'admin') {
    throw new AppError('Accès refusé', 403);
  }
  res.json({ duel });
}));

duelRouter.post('/:id/result', requireFields(['score', 'declaredWinner', 'screenshot']), asyncHandler(async (req, res) => {
  const duel = await submitResult(req.params.id, req.user._id, req.body);
  res.json({ duel });
}));

duelRouter.post('/:id/dispute', requireFields(['reason']), asyncHandler(async (req, res) => {
  const duel = await Duel.findById(req.params.id);
  if (!duel) throw new AppError('Duel non trouvé', 404);
  if (String(duel.player1) !== String(req.user._id) && String(duel.player2) !== String(req.user._id)) throw new AppError('Accès refusé', 403);
  duel.status = 'dispute';
  duel.disputeReason = req.body.reason;
  await duel.save();
  notifyRoom(duel.roomId, 'duel:dispute_opened', { duelId: duel._id, reason: req.body.reason });
  await notifyAdmins('admin:dispute_pending', { duelId: duel._id, reason: req.body.reason });
  res.json({ duel });
}));
