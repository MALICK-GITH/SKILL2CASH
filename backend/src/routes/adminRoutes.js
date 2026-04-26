import express from 'express';
import mongoose from 'mongoose';
import { Challenge } from '../models/Challenge.js';
import { CommissionSetting } from '../models/CommissionSetting.js';
import { Deposit } from '../models/Deposit.js';
import { Duel } from '../models/Duel.js';
import { Transaction } from '../models/Transaction.js';
import { User } from '../models/User.js';
import { AdminLog } from '../models/AdminLog.js';
import { UsernameChangeRequest } from '../models/UsernameChangeRequest.js';
import { Wallet } from '../models/Wallet.js';
import { Withdrawal } from '../models/Withdrawal.js';
import { protect, requireAdmin } from '../middleware/auth.js';
import { requireFields } from '../middleware/validate.js';
import { cancelDuel, finishDuel } from '../services/duelService.js';
import { approveManualDeposit, rejectManualDeposit } from '../services/depositService.js';
import { notifyUser } from '../services/notificationService.js';
import { adjustBalance } from '../services/walletService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { usernameRegex, validateEfootballUsername } from '../utils/username.js';

export const adminRouter = express.Router();
adminRouter.use(protect, requireAdmin);

adminRouter.get('/overview', asyncHandler(async (_req, res) => {
  const [users, activeDuels, disputes, pendingWithdrawals, walletTotals, commissionTotals] = await Promise.all([
    User.countDocuments(),
    Duel.countDocuments({ status: { $in: ['active', 'waiting_result'] } }),
    Duel.countDocuments({ status: 'dispute' }),
    Withdrawal.countDocuments({ status: 'pending' }),
    Wallet.aggregate([{ $group: { _id: null, available: { $sum: '$balanceAvailable' }, locked: { $sum: '$balanceLocked' }, total: { $sum: '$balanceTotal' } } }]),
    Transaction.aggregate([{ $match: { type: 'commission' } }, { $group: { _id: null, total: { $sum: '$amount' } } }])
  ]);

  res.json({
    users,
    activeDuels,
    disputes,
    pendingWithdrawals,
    pendingDeposits: await Deposit.countDocuments({ status: 'pending' }),
    pendingUsernameChanges: await UsernameChangeRequest.countDocuments({ status: 'pending' }),
    wallets: walletTotals[0] || { available: 0, locked: 0, total: 0 },
    commissionsEarned: commissionTotals[0]?.total || 0
  });
}));

adminRouter.get('/inbox', asyncHandler(async (_req, res) => {
  const [deposits, withdrawals, disputes, usernameRequests] = await Promise.all([
    Deposit.find({ status: 'pending' })
      .populate('user', 'username email country reportsCount isBanned')
      .sort({ createdAt: -1 })
      .limit(50),
    Withdrawal.find({ status: 'pending' })
      .populate('user', 'username email country reportsCount isBanned')
      .sort({ createdAt: -1 })
      .limit(50),
    Duel.find({ status: 'dispute' })
      .populate('player1 player2', 'username email country reportsCount isBanned')
      .sort({ updatedAt: -1 })
      .limit(50),
    UsernameChangeRequest.find({ status: 'pending' })
      .populate('user', 'username email country reportsCount isBanned')
      .sort({ createdAt: -1 })
      .limit(50)
  ]);

  const items = [
    ...deposits.map((deposit) => ({
      id: deposit._id,
      type: 'deposit',
      priority: deposit.amount >= 50000 || deposit.user?.reportsCount >= 3 ? 'high' : 'normal',
      title: `Dépôt ${deposit.method.toUpperCase()} à valider`,
      actor: deposit.user,
      amount: deposit.amount,
      status: deposit.status,
      createdAt: deposit.createdAt,
      payload: deposit
    })),
    ...withdrawals.map((withdrawal) => ({
      id: withdrawal._id,
      type: 'withdrawal',
      priority: withdrawal.amount >= 50000 || withdrawal.user?.reportsCount >= 3 ? 'high' : 'normal',
      title: `Retrait ${withdrawal.method} à traiter`,
      actor: withdrawal.user,
      amount: withdrawal.amount,
      status: withdrawal.status,
      createdAt: withdrawal.createdAt,
      payload: withdrawal
    })),
    ...disputes.map((duel) => ({
      id: duel._id,
      type: 'dispute',
      priority: 'high',
      title: 'Litige duel à résoudre',
      actor: duel.player1,
      opponent: duel.player2,
      amount: duel.potTotal,
      status: duel.status,
      createdAt: duel.updatedAt,
      payload: duel
    })),
    ...usernameRequests.map((request) => ({
      id: request._id,
      type: 'username',
      priority: 'normal',
      title: 'Changement username eFootball',
      actor: request.user,
      status: request.status,
      createdAt: request.createdAt,
      payload: request
    }))
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({
    items,
    counts: {
      deposits: deposits.length,
      withdrawals: withdrawals.length,
      disputes: disputes.length,
      usernameRequests: usernameRequests.length,
      total: items.length
    }
  });
}));

adminRouter.get('/username-change-requests', asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const requests = await UsernameChangeRequest.find(filter)
    .populate('user reviewedBy', 'username email country')
    .sort({ createdAt: -1 })
    .limit(100);
  res.json({ requests });
}));

adminRouter.post('/username-change-requests/:id/approve', asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const request = await session.withTransaction(async () => {
      const doc = await UsernameChangeRequest.findById(req.params.id).session(session);
      if (!doc) throw new AppError('Demande de changement de nom non trouvée', 404);
      if (doc.status !== 'pending') throw new AppError('Demande de changement de nom déjà traitée', 422);

      const requestedUsername = validateEfootballUsername(doc.requestedUsername);
      const existing = await User.findOne({ username: usernameRegex(requestedUsername), _id: { $ne: doc.user } }).session(session);
      if (existing) throw new AppError('Le nom eFootball demandé est déjà utilisé', 409);

      const user = await User.findById(doc.user).session(session);
      if (!user) throw new AppError('Utilisateur non trouvé', 404);
      user.username = requestedUsername;
      user.efootballUsername = requestedUsername;
      user.usernameLocked = true;
      await user.save({ session });

      doc.status = 'approved';
      doc.adminNote = req.body.adminNote || '';
      doc.reviewedAt = new Date();
      doc.reviewedBy = req.user._id;
      await doc.save({ session });

      await AdminLog.create([{
        admin: req.user._id,
        action: 'username_change_approved',
        targetType: 'UsernameChangeRequest',
        targetId: doc._id,
        note: doc.adminNote,
        metadata: { oldUsername: doc.currentUsername, newUsername: requestedUsername }
      }], { session });

      return doc;
    });
    notifyUser(request.user, 'username:change_approved', { requestId: request._id, username: request.requestedUsername });
    res.json({ request });
  } finally {
    await session.endSession();
  }
}));

adminRouter.post('/username-change-requests/:id/reject', asyncHandler(async (req, res) => {
  const request = await UsernameChangeRequest.findById(req.params.id);
  if (!request) throw new AppError('Demande de changement de nom non trouvée', 404);
  if (request.status !== 'pending') throw new AppError('Demande de changement de nom déjà traitée', 422);

  request.status = 'rejected';
  request.adminNote = req.body.adminNote || 'Rejeté par l\'admin';
  request.reviewedAt = new Date();
  request.reviewedBy = req.user._id;
  await request.save();
  await AdminLog.create({
    admin: req.user._id,
    action: 'username_change_rejected',
    targetType: 'UsernameChangeRequest',
    targetId: request._id,
    note: request.adminNote,
    metadata: { requestedUsername: request.requestedUsername }
  });
  notifyUser(request.user, 'username:change_rejected', { requestId: request._id, note: request.adminNote });
  res.json({ request });
}));

adminRouter.get('/deposits', asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.method) filter.method = req.query.method;
  if (req.query.user && mongoose.Types.ObjectId.isValid(req.query.user)) {
    filter.user = new mongoose.Types.ObjectId(req.query.user);
  }
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
  }

  const deposits = await Deposit.find(filter)
    .populate('user approvedBy', 'username email country reportsCount isBanned')
    .sort({ createdAt: -1 })
    .limit(100);

  const totals = await Deposit.aggregate([
    { $match: filter },
    { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } }
  ]);

  res.json({ deposits, totals });
}));

adminRouter.post('/deposits/:id/approve', asyncHandler(async (req, res) => {
  const deposit = await approveManualDeposit(req.params.id, req.user._id, req.body.adminNote || '');
  res.json({ deposit });
}));

adminRouter.post('/deposits/:id/reject', asyncHandler(async (req, res) => {
  const deposit = await rejectManualDeposit(req.params.id, req.user._id, req.body.adminNote || '');
  res.json({ deposit });
}));

adminRouter.get('/users', asyncHandler(async (_req, res) => {
  const users = await User.find().select('-passwordHash').sort({ createdAt: -1 }).limit(100);
  const wallets = await Wallet.find({ user: { $in: users.map((u) => u._id) } });
  res.json({ users, wallets });
}));

adminRouter.get('/duels', asyncHandler(async (_req, res) => {
  const duels = await Duel.find().populate('player1 player2 winner loser', 'username email country').sort({ createdAt: -1 }).limit(100);
  res.json({ duels });
}));

adminRouter.get('/disputes', asyncHandler(async (_req, res) => {
  const disputes = await Duel.find({ status: 'dispute' }).populate('player1 player2 winner loser', 'username email country').sort({ updatedAt: -1 });
  res.json({ disputes });
}));

adminRouter.post('/disputes/:id/resolve', requireFields(['action']), asyncHandler(async (req, res) => {
  const { action, winnerId, reason } = req.body;
  if (action === 'winner') {
    if (!winnerId) throw new AppError('winnerId est requis', 422);
    const duel = await finishDuel(req.params.id, winnerId);
    return res.json({ duel });
  }
  if (action === 'cancel') {
    const duel = await cancelDuel(req.params.id, reason || 'Dispute resolved by refund');
    return res.json({ duel });
  }
  throw new AppError('Action de résolution inconnue', 422);
}));

adminRouter.post('/withdrawals/:id/approve', asyncHandler(async (req, res) => {
  const withdrawal = await Withdrawal.findById(req.params.id);
  if (!withdrawal) throw new AppError('Retrait non trouvé', 404);
  if (withdrawal.status !== 'pending') throw new AppError('Retrait déjà traité', 422);
  withdrawal.status = req.body.markPaid ? 'paid' : 'approved';
  withdrawal.adminNote = req.body.adminNote || '';
  await withdrawal.save();
  await Transaction.updateOne({ referenceId: withdrawal._id, type: 'withdraw' }, { status: withdrawal.status === 'paid' ? 'success' : 'pending' });
  notifyUser(withdrawal.user, 'withdrawal:approved', { withdrawalId: withdrawal._id, status: withdrawal.status });
  res.json({ withdrawal });
}));

adminRouter.post('/withdrawals/:id/reject', asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const withdrawal = await session.withTransaction(async () => {
      const doc = await Withdrawal.findById(req.params.id).session(session);
      if (!doc) throw new AppError('Retrait non trouvé', 404);
      if (doc.status !== 'pending') throw new AppError('Retrait déjà traité', 422);
      doc.status = 'rejected';
      doc.adminNote = req.body.adminNote || 'Rejected by admin';
      await doc.save({ session });
      await adjustBalance(doc.user, doc.amount, `Remboursement de retrait rejeté: ${doc.adminNote}`, session);
      await Transaction.updateOne({ referenceId: doc._id, type: 'withdraw' }, { status: 'cancelled' }).session(session);
      return doc;
    });
    notifyUser(withdrawal.user, 'withdrawal:rejected', { withdrawalId: withdrawal._id });
    res.json({ withdrawal });
  } finally {
    await session.endSession();
  }
}));

adminRouter.post('/users/:id/ban', asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { isBanned: Boolean(req.body.isBanned ?? true) }, { new: true }).select('-passwordHash');
  if (!user) throw new AppError('Utilisateur non trouvé', 404);
  res.json({ user });
}));

adminRouter.post('/users/:id/adjust-balance', requireFields(['amount', 'description']), asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const wallet = await session.withTransaction(() => adjustBalance(req.params.id, Number(req.body.amount), req.body.description, session));
    res.json({ wallet });
  } finally {
    await session.endSession();
  }
}));

adminRouter.get('/commissions', asyncHandler(async (_req, res) => {
  const settings = await CommissionSetting.find().sort({ minAmount: 1 });
  res.json({ settings });
}));

adminRouter.post('/commissions', requireFields(['name', 'minAmount', 'rate']), asyncHandler(async (req, res) => {
  const setting = await CommissionSetting.create({
    name: req.body.name,
    minAmount: Number(req.body.minAmount),
    maxAmount: req.body.maxAmount === undefined || req.body.maxAmount === '' ? null : Number(req.body.maxAmount),
    rate: Number(req.body.rate),
    type: req.body.type || 'duel',
    active: req.body.active ?? true
  });
  res.status(201).json({ setting });
}));

adminRouter.get('/challenges', asyncHandler(async (_req, res) => {
  const challenges = await Challenge.find().populate('challenger challenged', 'username email country').sort({ createdAt: -1 }).limit(100);
  res.json({ challenges });
}));
