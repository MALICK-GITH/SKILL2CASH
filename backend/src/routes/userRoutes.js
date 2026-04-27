import express from 'express';
import mongoose from 'mongoose';
import { Duel } from '../models/Duel.js';
import { User } from '../models/User.js';
import { UsernameChangeRequest } from '../models/UsernameChangeRequest.js';
import { protect } from '../middleware/auth.js';
import { requireFields } from '../middleware/validate.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getPagination } from '../utils/pagination.js';
import { usernameRegex, validateEfootballUsername } from '../utils/username.js';

export const userRouter = express.Router();

const publicFields = '-passwordHash -blockedUsers -email';

userRouter.get('/', asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const users = await User.find({ isBanned: false }).select(publicFields).sort({ totalEarnings: -1 }).skip(skip).limit(limit);
  res.json({ users, page, limit });
}));

userRouter.get('/search', asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = { isBanned: false };

  if (req.query.q) filter.username = { $regex: req.query.q, $options: 'i' };
  if (req.query.country) filter.country = req.query.country;
  if (req.query.level) filter.level = req.query.level;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.available === 'true') filter.status = 'available';
  if (req.query.online === 'true') filter.status = 'online';
  if (req.query.excludeId && mongoose.Types.ObjectId.isValid(req.query.excludeId)) {
    filter._id = { $ne: new mongoose.Types.ObjectId(req.query.excludeId) };
  }
  if (req.query.minWinRate) filter.$expr = { $gte: [{ $cond: [{ $eq: [{ $add: ['$wins', '$losses'] }, 0] }, 0, { $multiply: [{ $divide: ['$wins', { $add: ['$wins', '$losses'] }] }, 100] }] }, Number(req.query.minWinRate)] };
  if (req.query.minStake || req.query.maxStake) {
    filter.minStake = {};
    if (req.query.minStake) filter.minStake.$gte = Number(req.query.minStake);
    if (req.query.maxStake) filter.maxStake = { $lte: Number(req.query.maxStake) };
  }

  const sort = req.query.top === 'true'
    ? { totalEarnings: -1, wins: -1 }
    : req.query.new === 'true'
      ? { createdAt: -1 }
      : { status: 1, reportsCount: 1, reputation: -1, wins: -1, totalEarnings: -1, username: 1 };
  const users = await User.find(filter).select(publicFields).sort(sort).skip(skip).limit(limit);
  res.json({ users, page, limit });
}));

userRouter.post('/username-change-requests', protect, requireFields(['requestedUsername']), asyncHandler(async (req, res) => {
  const requestedUsername = validateEfootballUsername(req.body.requestedUsername);
  if (requestedUsername.toLowerCase() === req.user.username.toLowerCase()) {
    throw new AppError('Le nom d\'utilisateur demandé est déjà votre nom eFootball actuel', 422);
  }

  const [existingUser, existingRequest] = await Promise.all([
    User.findOne({ username: usernameRegex(requestedUsername) }),
    UsernameChangeRequest.findOne({ user: req.user._id, status: 'pending' })
  ]);

  if (existingUser) throw new AppError('Ce nom eFootball est déjà utilisé', 409);
  if (existingRequest) throw new AppError('Vous avez déjà une demande de changement de nom en attente', 409);

  const request = await UsernameChangeRequest.create({
    user: req.user._id,
    currentUsername: req.user.username,
    requestedUsername,
    reason: req.body.reason || ''
  });

  res.status(201).json({ request });
}));

userRouter.get('/username-change-requests/me', protect, asyncHandler(async (req, res) => {
  const requests = await UsernameChangeRequest.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(10);
  res.json({ requests });
}));

userRouter.patch('/profile', protect, asyncHandler(async (req, res) => {
  const allowed = ['avatar', 'country', 'level', 'status', 'minStake', 'maxStake'];
  for (const field of allowed) {
    if (req.body[field] !== undefined) req.user[field] = req.body[field];
  }

  if (req.body.level !== undefined && !['Beginner', 'Intermediate', 'Pro', 'Elite'].includes(req.user.level)) {
    throw new AppError('Le niveau de profil est invalide', 422);
  }
  if (req.body.status !== undefined && !['online', 'offline', 'busy', 'available'].includes(req.user.status)) {
    throw new AppError('Le statut de profil est invalide', 422);
  }

  if (req.user.minStake !== undefined && (!Number.isFinite(Number(req.user.minStake)) || Number(req.user.minStake) < 0)) {
    throw new AppError('La mise minimale doit être un nombre positif ou nul', 422);
  }
  if (req.user.maxStake !== undefined && (!Number.isFinite(Number(req.user.maxStake)) || Number(req.user.maxStake) < 0)) {
    throw new AppError('La mise maximale doit être un nombre positif ou nul', 422);
  }
  if (req.user.minStake !== undefined && req.user.maxStake !== undefined && Number(req.user.minStake) > Number(req.user.maxStake)) {
    throw new AppError('La mise minimale ne peut pas dépasser la mise maximale', 422);
  }

  await req.user.save();
  res.json({ user: req.user });
}));

userRouter.get('/:id', asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select(publicFields);
  if (!user) return res.status(404).json({ message: 'User not found' });
  const recentDuels = await Duel.find({ $or: [{ player1: user._id }, { player2: user._id }], status: 'finished' })
    .populate('player1 player2 winner', 'username avatar country')
    .sort({ finishedAt: -1 })
    .limit(8);
  res.json({ user, recentDuels });
}));
