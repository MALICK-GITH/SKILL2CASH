import express from 'express';
import mongoose from 'mongoose';
import { Challenge } from '../models/Challenge.js';
import { User } from '../models/User.js';
import { protect } from '../middleware/auth.js';
import { requireFields } from '../middleware/validate.js';
import { acceptChallenge } from '../services/duelService.js';
import { notifyAdmins, notifyUser } from '../services/notificationService.js';
import { notifyChallenge, notifyChallengeAccepted, notifyChallengeDeclined } from '../utils/telegramNotify.js';
import { ensureWallet, lockStake, refundStake } from '../services/walletService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const challengeRouter = express.Router();
export const OPEN_CHALLENGE_STATUSES = ['pending', 'counter_offer'];

export function openChallengeFilter(userId, role, now = new Date()) {
  return {
    [role]: userId,
    status: { $in: OPEN_CHALLENGE_STATUSES },
    expiresAt: { $gt: now }
  };
}

export async function markExpiredOpenChallenges(now = new Date()) {
  const updated = [];
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const challenges = await Challenge.find({
        status: { $in: OPEN_CHALLENGE_STATUSES },
        expiresAt: { $lte: now }
      }).session(session);

      for (const challenge of challenges) {
        if (Number(challenge.reservedAmount || 0) > 0) {
          await refundStake(challenge.challenger, challenge.reservedAmount, challenge._id, session);
        }
        challenge.status = 'expired';
        await challenge.save({ session });
        updated.push(challenge);
      }
    });
  } finally {
    await session.endSession();
  }

  if (!updated.length) return 0;

  await Promise.allSettled(
    updated.flatMap((challenge) => ([
      notifyUser(challenge.challenger, 'challenge:expired', { challengeId: challenge._id }),
      notifyUser(challenge.challenged, 'challenge:expired', { challengeId: challenge._id })
    ]))
  );

  return updated.length;
}

export function isRequesterBlocked(challenged, requesterId) {
  const blockedUsers = Array.isArray(challenged?.blockedUsers) ? challenged.blockedUsers : [];
  return blockedUsers.some((id) => String(id) === String(requesterId));
}

function requireOpenChallenge(challenge) {
  if (!challenge) throw new AppError('Défi non trouvé', 404);
  if (!OPEN_CHALLENGE_STATUSES.includes(challenge.status)) {
    throw new AppError('Ce défi n\'est plus modifiable', 422);
  }
  const now = new Date();
  if (!challenge.expiresAt || new Date(challenge.expiresAt) <= now) {
    throw new AppError('Défi expiré', 422);
  }
}

challengeRouter.get('/public', asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 12), 1), 24);
  const now = new Date();
  await markExpiredOpenChallenges(now);
  const challenges = await Challenge.find({
    status: { $in: OPEN_CHALLENGE_STATUSES },
    expiresAt: { $gt: now }
  })
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
  const challengedId = String(req.body.challengedId || '').trim();
  const amount = Number(req.body.amount);
  if (!mongoose.Types.ObjectId.isValid(challengedId)) {
    throw new AppError('Joueur défié invalide', 422);
  }
  if (String(req.user._id) === challengedId) throw new AppError('Vous ne pouvez pas vous défier vous-même', 422);
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError('Le montant du défi doit être positif', 422);

  const challenged = await User.findById(challengedId);
  if (!challenged || challenged.isBanned) throw new AppError('Joueur défié non trouvé', 404);
  if (isRequesterBlocked(challenged, req.user._id)) throw new AppError('Ce joueur vous a bloqué', 403);

  const minutes = Math.min(Math.max(Number(req.body.acceptanceMinutes || 30), 5), 1440);
  const session = await mongoose.startSession();
  try {
    const challenge = await session.withTransaction(async () => {
      const wallet = await ensureWallet(req.user._id, session);
      if (wallet.balanceAvailable < amount) throw new AppError('Solde disponible insuffisant', 422);

      const created = await Challenge.create([{
        challenger: req.user._id,
        challenged: challenged._id,
        amount,
        reservedAmount: amount,
        fundsReservedAt: new Date(),
        matchType: req.body.matchType || 'eFootball 1v1',
        rules: req.body.rules || 'Standard 10 min, no cheats, screenshot required.',
        message: req.body.message || '',
        roomId: `challenge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        expiresAt: new Date(Date.now() + minutes * 60 * 1000)
      }], { session });

      const challengeDoc = created[0];
      await lockStake(req.user._id, amount, challengeDoc._id, session);
      return challengeDoc;
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

    // Notification Telegram au joueur défié avec boutons Accepter/Refuser
    if (challenged.telegramId && challenged.notificationPreferences?.telegram?.challenges !== false) {
      await notifyChallenge(
        challenged._id,
        challenge,
        req.user
      );
    }

    res.status(201).json({ challenge });
  } finally {
    await session.endSession();
  }
}));

challengeRouter.get('/incoming', asyncHandler(async (req, res) => {
  const now = new Date();
  await markExpiredOpenChallenges(now);
  const challenges = await Challenge.find(openChallengeFilter(req.user._id, 'challenged', now))
    .populate('challenger', 'username efootballUsername avatar country rank')
    .sort({ createdAt: -1 });
  res.json({ challenges });
}));

challengeRouter.get('/outgoing', asyncHandler(async (req, res) => {
  const now = new Date();
  await markExpiredOpenChallenges(now);
  const challenges = await Challenge.find(openChallengeFilter(req.user._id, 'challenger', now))
    .populate('challenged', 'username efootballUsername avatar country rank')
    .sort({ createdAt: -1 });
  res.json({ challenges });
}));

challengeRouter.post('/:id/accept', asyncHandler(async (req, res) => {
  const duel = await acceptChallenge(req.params.id, req.user._id);
  res.json({ duel });
}));

challengeRouter.post('/:id/decline', asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const challenge = await session.withTransaction(async () => {
      const doc = await Challenge.findOne({ _id: req.params.id, challenged: req.user._id }).session(session);
      requireOpenChallenge(doc);
      if (Number(doc.reservedAmount || 0) > 0) {
        await refundStake(doc.challenger, doc.reservedAmount, doc._id, session);
      }
      doc.status = 'declined';
      await doc.save({ session });
      return doc;
    });
    await notifyUser(challenge.challenger, 'challenge:declined', { challengeId: challenge._id });
    await notifyUser(challenge.challenged, 'challenge:declined', { challengeId: challenge._id });
    res.json({ challenge });
  } finally {
    await session.endSession();
  }
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
  const session = await mongoose.startSession();
  try {
    const challenge = await session.withTransaction(async () => {
      const doc = await Challenge.findOne({ _id: req.params.id, challenger: req.user._id }).session(session);
      if (!doc) throw new AppError('Défi non trouvé', 404);
      if (!OPEN_CHALLENGE_STATUSES.includes(doc.status)) {
        throw new AppError('Un défi déjà traité ne peut pas être annulé ici', 422);
      }
      const now = new Date();
      if (!doc.expiresAt || new Date(doc.expiresAt) <= now) {
        throw new AppError('Défi expiré', 422);
      }
      if (Number(doc.reservedAmount || 0) > 0) {
        await refundStake(doc.challenger, doc.reservedAmount, doc._id, session);
      }
      doc.status = 'cancelled';
      await doc.save({ session });
      return doc;
    });
    await notifyUser(challenge.challenged, 'challenge:cancelled', { challengeId: challenge._id });
    await notifyUser(challenge.challenger, 'challenge:cancelled', { challengeId: challenge._id });
    res.json({ challenge });
  } finally {
    await session.endSession();
  }
}));
