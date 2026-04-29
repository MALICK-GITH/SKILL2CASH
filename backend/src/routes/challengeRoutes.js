import express from 'express';
import { Challenge } from '../models/Challenge.js';
import { User } from '../models/User.js';
import { protect } from '../middleware/auth.js';
import { requireFields } from '../middleware/validate.js';
import { acceptChallenge } from '../services/duelService.js';
import { notifyAdmins, notifyUser } from '../services/notificationService.js';
import { ensureWallet } from '../services/walletService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const challengeRouter = express.Router();

function requireOpenChallenge(challenge) {
  if (!challenge) throw new AppError('Défi non trouvé', 404);
  if (!['pending', 'counter_offer'].includes(challenge.status)) {
    throw new AppError('Ce défi n\'est plus modifiable', 422);
  }
  if (challenge.expiresAt < new Date()) {
    throw new AppError('Défi expiré', 422);
  }
}

challengeRouter.get('/public', asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 12), 1), 24);
  const challenges = await Challenge.find({ status: { $in: ['pending', 'counter_offer'] } })
    .populate('challenger', 'username efootballUsername avatar country rank status reputation winRate minStake maxStake')
    .populate('challenged', 'username efootballUsername avatar country rank status reputation winRate minStake maxStake')
    .sort({ createdAt: -1 })
    .limit(limit);

  res.json({
    challenges: challenges.map((challenge) => ({
      id: challenge._id,
      challenger: challenge.challenger,
      challenged: challenge.challenged,
      amount: challenge.amount,
      matchType: challenge.matchType,
      rules: challenge.rules,
      status: challenge.status,
      createdAt: challenge.createdAt,
      expiresAt: challenge.expiresAt,
      counterAmount: challenge.counterAmount
    }))
  });
}));

challengeRouter.use(protect);

challengeRouter.post('/', requireFields(['challengedId', 'amount']), asyncHandler(async (req, res) => {
  const amount = Number(req.body.amount);
  if (String(req.user._id) === String(req.body.challengedId)) throw new AppError('Vous ne pouvez pas vous défier vous-même', 422);
  if (amount <= 0) throw new AppError('Le montant du défi doit être positif', 422);

  const challenged = await User.findById(req.body.challengedId);
  if (!challenged || challenged.isBanned) throw new AppError('Joueur défié non trouvé', 404);
  if (challenged.blockedUsers.some((id) => String(id) === String(req.user._id))) throw new AppError('Ce joueur vous a bloqué', 403);

  const wallet = await ensureWallet(req.user._id);
  if (wallet.balanceAvailable < amount) throw new AppError('Solde disponible insuffisant', 422);

  const minutes = Math.min(Math.max(Number(req.body.acceptanceMinutes || 30), 5), 1440);
  const challenge = await Challenge.create({
    challenger: req.user._id,
    challenged: challenged._id,
    amount,
    matchType: req.body.matchType || 'eFootball 1v1',
    rules: req.body.rules || 'Standard 10 min, no cheats, screenshot required.',
    message: req.body.message || '',
    roomId: `challenge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    expiresAt: new Date(Date.now() + minutes * 60 * 1000)
  });

  await notifyUser(req.user._id, 'challenge:created', {
    challengeId: challenge._id,
    amount,
    challengedUsername: challenged.efootballUsername || challenged.username
  });
  await notifyUser(challenged._id, 'challenge:new', {
    challengeId: challenge._id,
    from: req.user.efootballUsername || req.user.username,
    amount,
    action: 'accept_challenge'
  });
  await notifyAdmins('admin:challenge_created', {
    challengeId: challenge._id,
    amount,
    challengerId: req.user._id,
    challengedId: challenged._id
  });

  res.status(201).json({ challenge });
}));

challengeRouter.get('/incoming', asyncHandler(async (req, res) => {
  const challenges = await Challenge.find({ challenged: req.user._id }).populate('challenger', 'username efootballUsername avatar country rank').sort({ createdAt: -1 });
  res.json({ challenges });
}));

challengeRouter.get('/outgoing', asyncHandler(async (req, res) => {
  const challenges = await Challenge.find({ challenger: req.user._id }).populate('challenged', 'username efootballUsername avatar country rank').sort({ createdAt: -1 });
  res.json({ challenges });
}));

challengeRouter.post('/:id/accept', asyncHandler(async (req, res) => {
  const duel = await acceptChallenge(req.params.id, req.user._id);
  res.json({ duel });
}));

challengeRouter.post('/:id/decline', asyncHandler(async (req, res) => {
  const challenge = await Challenge.findOne({ _id: req.params.id, challenged: req.user._id });
  requireOpenChallenge(challenge);
  challenge.status = 'declined';
  await challenge.save();
  await notifyUser(challenge.challenger, 'challenge:declined', { challengeId: challenge._id });
  await notifyUser(challenge.challenged, 'challenge:declined', { challengeId: challenge._id });
  res.json({ challenge });
}));

challengeRouter.post('/:id/counter', requireFields(['counterAmount']), asyncHandler(async (req, res) => {
  const challenge = await Challenge.findOne({ _id: req.params.id, challenged: req.user._id });
  requireOpenChallenge(challenge);
  const counterAmount = Number(req.body.counterAmount);
  if (!Number.isFinite(counterAmount) || counterAmount <= 0) {
    throw new AppError('Le montant de contre-proposition doit être positif', 422);
  }
  challenge.status = 'counter_offer';
  challenge.counterAmount = counterAmount;
  await challenge.save();
  await notifyUser(challenge.challenger, 'challenge:counter_offer', { challengeId: challenge._id, counterAmount: challenge.counterAmount });
  await notifyUser(challenge.challenged, 'challenge:counter_offer', { challengeId: challenge._id, counterAmount: challenge.counterAmount });
  res.json({ challenge });
}));

challengeRouter.post('/:id/cancel', asyncHandler(async (req, res) => {
  const challenge = await Challenge.findOne({ _id: req.params.id, challenger: req.user._id });
  if (!challenge) throw new AppError('Défi non trouvé', 404);
  if (!['pending', 'counter_offer'].includes(challenge.status)) {
    throw new AppError('Un défi déjà traité ne peut pas être annulé ici', 422);
  }
  if (challenge.expiresAt < new Date()) {
    throw new AppError('Défi expiré', 422);
  }
  challenge.status = 'cancelled';
  await challenge.save();
  await notifyUser(challenge.challenged, 'challenge:cancelled', { challengeId: challenge._id });
  await notifyUser(challenge.challenger, 'challenge:cancelled', { challengeId: challenge._id });
  res.json({ challenge });
}));
