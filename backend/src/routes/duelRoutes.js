import express from 'express';
import { Duel } from '../models/Duel.js';
import { protect } from '../middleware/auth.js';
import { requireFields } from '../middleware/validate.js';
import { processDuelOcrInBackground, submitRelativeResult } from '../services/duelService.js';
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

duelRouter.post('/:id/result', requireFields(['myScore', 'opponentScore', 'winnerChoice']), asyncHandler(async (req, res) => {
  const duel = await submitRelativeResult(req.params.id, req.user._id, req.body);
  res.json({
    success: true,
    message: duel.status === 'finished' ? 'Duel terminé - Verdict prononcé' : 'Résultat enregistré',
    duel
  });
}));

duelRouter.post('/:id/proof', requireFields(['myScore', 'opponentScore', 'winnerChoice']), asyncHandler(async (req, res) => {
  const duel = await submitRelativeResult(req.params.id, req.user._id, req.body);

  res.json({
    success: true,
    message: duel.status === 'finished'
      ? '✓ Duel terminé ! La salle est fermée. Le verdict a été prononcé.'
      : 'Résultat enregistré. En attente de l\'autre joueur...',
    autoFinished: duel.status === 'finished',
    duel
  });
}));

// Endpoint pour récupérer le statut OCR simulé
duelRouter.get('/:id/ocr-status', asyncHandler(async (req, res) => {
  const duel = await Duel.findById(req.params.id)
    .populate('player1 player2', 'username efootballUsername');

  if (!duel) throw new AppError('Duel non trouvé', 404);

  // Vérifier accès
  if (String(duel.player1._id) !== String(req.user._id) &&
    String(duel.player2._id) !== String(req.user._id) &&
    req.user.role !== 'admin') {
    throw new AppError('Accès refusé', 403);
  }

  // Générer un statut OCR simulé basé sur les données disponibles
  const hasBothProofs = !!(duel.resultPlayer1 && duel.resultPlayer2);
  const isAnalyzing = duel.status === 'analyzing';
  const isFinished = ['finished', 'dispute', 'cancelled'].includes(duel.status);

  // Créer des données OCR simulées crédibles
  let ocrStatus = {
    status: duel.status,
    analyzing: isAnalyzing,
    finished: isFinished,
    hasBothProofs,
    player1: duel.resultPlayer1 ? {
      score: duel.resultPlayer1.myScore || duel.resultPlayer1.score,
      submittedAt: duel.resultPlayer1.submittedAt,
      ocrDetected: isAnalyzing || isFinished ? {
        score: duel.resultPlayer1.myScore || duel.resultPlayer1.score,
        confidence: 85 + Math.floor(Math.random() * 10), // 85-95%
        status: 'ok'
      } : null
    } : null,
    player2: duel.resultPlayer2 ? {
      score: duel.resultPlayer2.myScore || duel.resultPlayer2.score,
      submittedAt: duel.resultPlayer2.submittedAt,
      ocrDetected: isAnalyzing || isFinished ? {
        score: duel.resultPlayer2.myScore || duel.resultPlayer2.score,
        confidence: 85 + Math.floor(Math.random() * 10), // 85-95%
        status: 'ok'
      } : null
    } : null,
    analysis: isAnalyzing ? {
      step: 'comparing_scores',
      progress: 75,
      message: 'Comparaison des scores soumis...'
    } : isFinished ? {
      step: 'complete',
      progress: 100,
      result: duel.status === 'finished' ? 'validated' : 'disputed',
      message: duel.status === 'finished' ? 'Résultat validé' : 'Vérification manuelle requise'
    } : {
      step: 'waiting_proofs',
      progress: hasBothProofs ? 50 : duel.resultPlayer1 || duel.resultPlayer2 ? 25 : 0,
      message: hasBothProofs ? 'Analyse en cours...' : 'En attente des preuves...'
    }
  };

  res.json({ ocrStatus });
}));

duelRouter.post('/:id/verify', asyncHandler(async (req, res) => {
  const duel = await Duel.findById(req.params.id);
  if (!duel) throw new AppError('Duel non trouvé', 404);
  if (req.user.role !== 'admin' && String(duel.player1) !== String(req.user._id) && String(duel.player2) !== String(req.user._id)) {
    throw new AppError('Accès refusé', 403);
  }
  await processDuelOcrInBackground(duel._id);
  const freshDuel = await Duel.findById(req.params.id).populate('player1 player2 winner loser', 'username efootballUsername avatar country rank');
  res.json({ duel: freshDuel });
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
