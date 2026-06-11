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
import { cancelDuel, cancelDuelNoRefund, finishDuel } from '../services/duelService.js';
import { logAdminAction } from '../services/auditLogService.js';
import { approveManualDeposit, rejectManualDeposit } from '../services/depositService.js';
import { cancelOpenChallenges } from '../services/adminChallengeService.js';
import { notifyAdmins, notifyUser } from '../services/notificationService.js';
import { adjustBalance } from '../services/walletService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { usernameRegex, validateEfootballUsername } from '../utils/username.js';

export const adminRouter = express.Router();
adminRouter.use(protect, requireAdmin);
function requireObjectId(id, message = 'Identifiant invalide') {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError(message, 422);
}

function parsePositiveAmount(value, message) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError(message, 422);
  return amount;
}

adminRouter.get('/overview', asyncHandler(async (_req, res) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [users, activeDuels, disputes, pendingWithdrawals, walletTotals, commissionTotals,
    todayStats, weekStats, monthStats, topUsers, duelStats] = await Promise.all([
      User.countDocuments(),
      Duel.countDocuments({ status: { $in: ['active', 'waiting_player1_proof', 'waiting_player2_proof', 'analyzing', 'waiting_result', 'under_review'] } }),
      Duel.countDocuments({ status: 'dispute' }),
      Withdrawal.countDocuments({ status: 'pending' }),
      Wallet.aggregate([{ $group: { _id: null, available: { $sum: '$balanceAvailable' }, locked: { $sum: '$balanceLocked' }, total: { $sum: '$balanceTotal' } } }]),
      Transaction.aggregate([{ $match: { type: 'commission' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      // Stats du jour
      Duel.aggregate([
        { $match: { createdAt: { $gte: today } } },
        { $group: { _id: null, count: { $sum: 1 }, totalAmount: { $sum: '$amount' }, finished: { $sum: { $cond: [{ $eq: ['$status', 'finished'] }, 1, 0] } } } }
      ]),
      // Stats de la semaine
      Duel.aggregate([
        { $match: { createdAt: { $gte: weekAgo } } },
        { $group: { _id: null, count: { $sum: 1 }, totalAmount: { $sum: '$amount' }, commissions: { $sum: '$commissionAmount' } } }
      ]),
      // Stats du mois
      Duel.aggregate([
        { $match: { createdAt: { $gte: monthAgo } } },
        { $group: { _id: '$status', count: { $sum: 1 }, totalAmount: { $sum: '$amount' } } }
      ]),
      // Top utilisateurs
      User.find().select('username efootballUsername wins totalEarnings').sort({ totalEarnings: -1 }).limit(10),
      // Stats détaillées des duels
      Duel.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 }, avgAmount: { $avg: '$amount' }, totalPot: { $sum: '$potTotal' } } }
      ])
    ]);

  const monthByStatus = monthStats.reduce((acc, s) => ({ ...acc, [s._id]: { count: s.count, totalAmount: s.totalAmount } }), {});

  res.json({
    users,
    activeDuels,
    disputes,
    pendingWithdrawals,
    pendingDeposits: await Deposit.countDocuments({ status: 'pending' }),
    pendingUsernameChanges: await UsernameChangeRequest.countDocuments({ status: 'pending' }),
    wallets: walletTotals[0] || { available: 0, locked: 0, total: 0 },
    commissionsEarned: commissionTotals[0]?.total || 0,
    timeStats: {
      today: todayStats[0] || { count: 0, totalAmount: 0, finished: 0 },
      week: weekStats[0] || { count: 0, totalAmount: 0, commissions: 0 },
      month: { byStatus: monthByStatus, totalDuels: monthStats.reduce((s, i) => s + i.count, 0) }
    },
    topUsers,
    duelStats: duelStats.reduce((acc, s) => ({ ...acc, [s._id]: s }), {})
  });
}));

adminRouter.get('/inbox', asyncHandler(async (_req, res) => {
  const [deposits, withdrawals, disputes, usernameRequests] = await Promise.all([
    Deposit.find({ status: 'pending' })
      .populate('user', 'username efootballUsername email country reportsCount isBanned')
      .sort({ createdAt: -1 })
      .limit(50),
    Withdrawal.find({ status: 'pending' })
      .populate('user', 'username efootballUsername email country reportsCount isBanned')
      .sort({ createdAt: -1 })
      .limit(50),
    Duel.find({ status: 'dispute' })
      .populate('player1 player2', 'username efootballUsername email country reportsCount isBanned')
      .sort({ updatedAt: -1 })
      .limit(50),
    UsernameChangeRequest.find({ status: 'pending' })
      .populate('user', 'username efootballUsername email country reportsCount isBanned')
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
    .populate('user reviewedBy', 'username efootballUsername email country')
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
    .populate('user approvedBy', 'username efootballUsername email country reportsCount isBanned')
    .sort({ createdAt: -1 })
    .limit(100);

  const totals = await Deposit.aggregate([
    { $match: filter },
    { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } }
  ]);

  res.json({ deposits, totals });
}));

adminRouter.get('/withdrawals', asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.method) filter.method = req.query.method;
  if (req.query.user && mongoose.Types.ObjectId.isValid(req.query.user)) {
    filter.user = new mongoose.Types.ObjectId(req.query.user);
  }

  const withdrawals = await Withdrawal.find(filter)
    .populate('user', 'username efootballUsername email country reportsCount isBanned')
    .sort({ createdAt: -1 })
    .limit(100);

  res.json({ withdrawals });
}));

adminRouter.post('/deposits/:id/approve', asyncHandler(async (req, res) => {
  requireObjectId(req.params.id, 'Identifiant de dépôt invalide');
  const deposit = await approveManualDeposit(req.params.id, req.user._id, req.body.adminNote || '');
  await notifyAdmins('admin:deposit_reviewed', {
    depositId: deposit._id,
    action: 'approved',
    amount: deposit.amount,
    method: deposit.method
  });
  res.json({ deposit });
}));

adminRouter.post('/deposits/:id/reject', asyncHandler(async (req, res) => {
  requireObjectId(req.params.id, 'Identifiant de dépôt invalide');
  const deposit = await rejectManualDeposit(req.params.id, req.user._id, req.body.adminNote || '');
  await notifyAdmins('admin:deposit_reviewed', {
    depositId: deposit._id,
    action: 'rejected',
    amount: deposit.amount,
    method: deposit.method
  });
  res.json({ deposit });
}));

adminRouter.get('/users', asyncHandler(async (_req, res) => {
  const users = await User.find().select('-passwordHash').sort({ createdAt: -1 });
  const wallets = await Wallet.find({ user: { $in: users.map((u) => u._id) } });
  res.json({ users, wallets });
}));

adminRouter.get('/duels', asyncHandler(async (_req, res) => {
  const duels = await Duel.find().populate('player1 player2 winner loser', 'username efootballUsername email country').sort({ createdAt: -1 }).limit(100);
  res.json({ duels });
}));

adminRouter.get('/disputes', asyncHandler(async (_req, res) => {
  const disputes = await Duel.find({ status: 'dispute' }).populate('player1 player2 winner loser', 'username efootballUsername email country').sort({ updatedAt: -1 });
  res.json({ disputes });
}));

adminRouter.post('/disputes/:id/resolve', requireFields(['action']), asyncHandler(async (req, res) => {
  requireObjectId(req.params.id, 'Identifiant de litige invalide');
  const { action, winnerId, reason } = req.body;
  if (action === 'winner') {
    if (!winnerId) throw new AppError('winnerId est requis', 422);
    requireObjectId(winnerId, 'winnerId invalide');
    const beforeDuel = await Duel.findById(req.params.id).select('status winner loser').lean();
    const duel = await finishDuel(req.params.id, winnerId);
    await AdminLog.create({
      admin: req.user._id,
      action: 'dispute_resolved_winner',
      targetType: 'Duel',
      targetId: duel._id,
      note: String(reason || '').trim().slice(0, 300),
      metadata: { winnerId }
    });
    await logAdminAction({
      adminId: req.user._id,
      action: 'dispute_resolved_winner',
      targetType: 'Duel',
      targetId: duel._id,
      note: String(reason || '').trim().slice(0, 300),
      metadata: { winnerId },
      beforeState: beforeDuel,
      afterState: { status: duel.status, winner: duel.winner, loser: duel.loser },
      req
    });
    await notifyAdmins('admin:dispute_resolved', {
      duelId: duel._id,
      action: 'winner',
      winnerId
    });
    return res.json({ duel });
  }
  if (action === 'cancel') {
    const beforeDuel = await Duel.findById(req.params.id).select('status winner loser').lean();
    const duel = await cancelDuel(req.params.id, reason || 'Dispute resolved by refund');
    await AdminLog.create({
      admin: req.user._id,
      action: 'dispute_resolved_cancel',
      targetType: 'Duel',
      targetId: duel._id,
      note: String(reason || 'Dispute resolved by refund').trim().slice(0, 300),
      metadata: {}
    });
    await logAdminAction({
      adminId: req.user._id,
      action: 'dispute_resolved_cancel',
      targetType: 'Duel',
      targetId: duel._id,
      note: String(reason || 'Dispute resolved by refund').trim().slice(0, 300),
      beforeState: beforeDuel,
      afterState: { status: duel.status, winner: duel.winner, loser: duel.loser },
      req
    });
    await notifyAdmins('admin:dispute_resolved', {
      duelId: duel._id,
      action: 'cancel',
      reason: reason || 'Dispute resolved by refund'
    });
    return res.json({ duel });
  }
  if (action === 'cancel_no_refund') {
    const beforeDuel = await Duel.findById(req.params.id).select('status winner loser').lean();
    const duel = await cancelDuelNoRefund(req.params.id, reason || 'Dispute resolved - stakes retained by platform');
    await AdminLog.create({
      admin: req.user._id,
      action: 'dispute_resolved_cancel_no_refund',
      targetType: 'Duel',
      targetId: duel._id,
      note: String(reason || 'Dispute resolved - stakes retained by platform').trim().slice(0, 300),
      metadata: {}
    });
    await logAdminAction({
      adminId: req.user._id,
      action: 'dispute_resolved_cancel_no_refund',
      targetType: 'Duel',
      targetId: duel._id,
      note: String(reason || 'Dispute resolved - stakes retained by platform').trim().slice(0, 300),
      beforeState: beforeDuel,
      afterState: { status: duel.status, winner: duel.winner, loser: duel.loser },
      req
    });
    await notifyAdmins('admin:dispute_resolved', {
      duelId: duel._id,
      action: 'cancel_no_refund',
      reason: reason || 'Dispute resolved - stakes retained by platform'
    });
    return res.json({ duel });
  }
  throw new AppError('Action de résolution inconnue', 422);
}));

adminRouter.post('/withdrawals/:id/approve', asyncHandler(async (req, res) => {
  requireObjectId(req.params.id, 'Identifiant de retrait invalide');
  const session = await mongoose.startSession();
  try {
    let beforeSnapshot = null;
    const withdrawal = await session.withTransaction(async () => {
      const doc = await Withdrawal.findById(req.params.id).session(session);
      if (!doc) throw new AppError('Retrait non trouvé', 404);
      if (doc.status !== 'pending') throw new AppError('Retrait déjà traité', 422);
      beforeSnapshot = doc.toObject();

      doc.status = req.body.markPaid ? 'paid' : 'approved';
      doc.adminNote = req.body.adminNote || '';
      await doc.save({ session });

      await Transaction.updateOne(
        { referenceId: doc._id, type: 'withdraw' },
        { $set: { status: doc.status === 'paid' ? 'success' : 'pending' } }
      ).session(session);
      await AdminLog.create([{
        admin: req.user._id,
        action: doc.status === 'paid' ? 'withdrawal_paid' : 'withdrawal_approved',
        targetType: 'Withdrawal',
        targetId: doc._id,
        note: doc.adminNote,
        metadata: { amount: doc.amount, method: doc.method }
      }], { session });

      return doc;
    });
    await logAdminAction({
      adminId: req.user._id,
      action: withdrawal.status === 'paid' ? 'withdrawal_paid' : 'withdrawal_approved',
      targetType: 'Withdrawal',
      targetId: withdrawal._id,
      note: String(withdrawal.adminNote || '').trim().slice(0, 300),
      metadata: {
        amount: withdrawal.amount,
        method: withdrawal.method,
        fraudScore: withdrawal.fraudScore,
        fraudFlags: withdrawal.fraudFlags
      },
      beforeState: beforeSnapshot,
      afterState: { status: withdrawal.status, adminNote: withdrawal.adminNote },
      req
    });

    try {
      await notifyUser(withdrawal.user, 'withdrawal:approved', { withdrawalId: withdrawal._id, status: withdrawal.status });
      if (withdrawal.status === 'paid') {
        await notifyUser(withdrawal.user, 'withdrawal:paid', { withdrawalId: withdrawal._id, amount: withdrawal.amount });
      }
      await notifyAdmins('admin:withdrawal_reviewed', {
        withdrawalId: withdrawal._id,
        action: withdrawal.status,
        amount: withdrawal.amount,
        method: withdrawal.method
      });
    } catch { }
    res.json({ withdrawal });
  } finally {
    await session.endSession();
  }
}));
adminRouter.post('/withdrawals/:id/reject', asyncHandler(async (req, res) => {
  requireObjectId(req.params.id, 'Identifiant de retrait invalide');
  const session = await mongoose.startSession();
  try {
    let beforeSnapshot = null;
    const withdrawal = await session.withTransaction(async () => {
      const doc = await Withdrawal.findById(req.params.id).session(session);
      if (!doc) throw new AppError('Retrait non trouvé', 404);
      if (doc.status !== 'pending') throw new AppError('Retrait déjà traité', 422);
      beforeSnapshot = doc.toObject();
      doc.status = 'rejected';
      doc.adminNote = req.body.adminNote || 'Rejected by admin';
      await doc.save({ session });
      await adjustBalance(doc.user, doc.amount, `Remboursement de retrait rejeté: ${doc.adminNote}`, session);
      await Transaction.updateOne({ referenceId: doc._id, type: 'withdraw' }, { $set: { status: 'cancelled' } }).session(session);
      await AdminLog.create([{
        admin: req.user._id,
        action: 'withdrawal_rejected',
        targetType: 'Withdrawal',
        targetId: doc._id,
        note: doc.adminNote,
        metadata: { amount: doc.amount, method: doc.method }
      }], { session });
      return doc;
    });
    await logAdminAction({
      adminId: req.user._id,
      action: 'withdrawal_rejected',
      targetType: 'Withdrawal',
      targetId: withdrawal._id,
      note: String(withdrawal.adminNote || '').trim().slice(0, 300),
      metadata: {
        amount: withdrawal.amount,
        method: withdrawal.method,
        fraudScore: withdrawal.fraudScore,
        fraudFlags: withdrawal.fraudFlags
      },
      beforeState: beforeSnapshot,
      afterState: { status: withdrawal.status, adminNote: withdrawal.adminNote },
      req
    });
    try {
      await notifyUser(withdrawal.user, 'withdrawal:rejected', { withdrawalId: withdrawal._id });
      await notifyAdmins('admin:withdrawal_reviewed', {
        withdrawalId: withdrawal._id,
        action: 'rejected',
        amount: withdrawal.amount,
        method: withdrawal.method
      });
    } catch { }
    res.json({ withdrawal });
  } finally {
    await session.endSession();
  }
}));

adminRouter.post('/users/:id/ban', asyncHandler(async (req, res) => {
  requireObjectId(req.params.id, 'Identifiant utilisateur invalide');
  const beforeUser = await User.findById(req.params.id).select('_id isBanned username email').lean();
  const user = await User.findByIdAndUpdate(req.params.id, { isBanned: Boolean(req.body.isBanned ?? true) }, { new: true }).select('-passwordHash');
  if (!user) throw new AppError('Utilisateur non trouvé', 404);
  await AdminLog.create({
    admin: req.user._id,
    action: user.isBanned ? 'user_banned' : 'user_unbanned',
    targetType: 'User',
    targetId: user._id,
    note: String(req.body.reason || '').trim().slice(0, 300),
    metadata: {}
  });
  await logAdminAction({
    adminId: req.user._id,
    action: user.isBanned ? 'user_banned' : 'user_unbanned',
    targetType: 'User',
    targetId: user._id,
    note: String(req.body.reason || '').trim().slice(0, 300),
    beforeState: beforeUser,
    afterState: { isBanned: user.isBanned },
    req
  });
  res.json({ user });
}));

adminRouter.post('/users/:id/adjust-balance', requireFields(['amount', 'description']), asyncHandler(async (req, res) => {
  requireObjectId(req.params.id, 'Identifiant utilisateur invalide');
  const amount = parsePositiveAmount(req.body.amount, 'Montant d’ajustement invalide');
  const session = await mongoose.startSession();
  try {
    let beforeWallet = null;
    const wallet = await session.withTransaction(async () => {
      beforeWallet = await Wallet.findOne({ user: req.params.id }).session(session).lean();
      const adjustedWallet = await adjustBalance(
        req.params.id,
        amount,
        req.body.description,
        session,
        req.body.operation
      );
      await AdminLog.create([{
        admin: req.user._id,
        action: 'wallet_adjusted',
        targetType: 'User',
        targetId: new mongoose.Types.ObjectId(req.params.id),
        note: String(req.body.description || '').trim().slice(0, 300),
        metadata: { amount, operation: req.body.operation || 'add' }
      }], { session });
      return adjustedWallet;
    });
    await logAdminAction({
      adminId: req.user._id,
      action: 'wallet_adjusted',
      targetType: 'User',
      targetId: new mongoose.Types.ObjectId(req.params.id),
      note: String(req.body.description || '').trim().slice(0, 300),
      metadata: { amount, operation: req.body.operation || 'add' },
      beforeState: beforeWallet,
      afterState: {
        balanceAvailable: wallet.balanceAvailable,
        balanceLocked: wallet.balanceLocked,
        balanceTotal: wallet.balanceTotal
      },
      req
    });
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
  const name = String(req.body.name || '').trim();
  const minAmount = Number(req.body.minAmount);
  const maxAmount = req.body.maxAmount === undefined || req.body.maxAmount === '' ? null : Number(req.body.maxAmount);
  const rate = Number(req.body.rate);
  const type = req.body.type || 'duel';
  const active = req.body.active === undefined ? true : req.body.active === true || req.body.active === 'true';

  if (!name) throw new AppError('Le nom de la commission est requis', 422);
  if (!Number.isFinite(minAmount) || minAmount < 0) throw new AppError('Le montant minimum doit être un nombre positif ou nul', 422);
  if (maxAmount !== null && (!Number.isFinite(maxAmount) || maxAmount < minAmount)) {
    throw new AppError('Le montant maximum doit être supérieur ou égal au minimum', 422);
  }
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1) {
    throw new AppError('Le taux doit être compris entre 0 et 1', 422);
  }
  if (!['duel', 'tournament'].includes(type)) {
    throw new AppError('Le type de commission est invalide', 422);
  }

  const setting = await CommissionSetting.create({
    name,
    minAmount,
    maxAmount,
    rate,
    type,
    active: Boolean(active)
  });
  res.status(201).json({ setting });
}));

adminRouter.get('/challenges', asyncHandler(async (_req, res) => {
  const challenges = await Challenge.find().populate('challenger challenged', 'username email country').sort({ createdAt: -1 }).limit(100);
  res.json({ challenges });
}));

adminRouter.get('/ocr-summary', asyncHandler(async (_req, res) => {
  const [duels, deposits] = await Promise.all([
    Duel.aggregate([
      {
        $group: {
          _id: null,
          autoApproved: { $sum: { $cond: [{ $eq: ['$autoValidationStatus', 'auto_approved'] }, 1, 0] } },
          manualReview: { $sum: { $cond: [{ $eq: ['$autoValidationStatus', 'manual_review'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$autoValidationStatus', 'failed'] }, 1, 0] } }
        }
      }
    ]),
    Deposit.aggregate([
      {
        $group: {
          _id: null,
          matched: { $sum: { $cond: [{ $eq: ['$autoVerificationStatus', 'matched'] }, 1, 0] } },
          needsReview: { $sum: { $cond: [{ $eq: ['$autoVerificationStatus', 'needs_review'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$autoVerificationStatus', 'failed'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$autoVerificationStatus', 'pending'] }, 1, 0] } }
        }
      }
    ])
  ]);

  res.json({
    duelOcr: duels[0] || { autoApproved: 0, manualReview: 0, failed: 0 },
    depositOcr: deposits[0] || { matched: 0, needsReview: 0, failed: 0, pending: 0 }
  });
}));

adminRouter.get('/audit-logs', asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
  const filter = {};
  if (req.query.action) filter.action = req.query.action;
  if (req.query.targetType) filter.targetType = req.query.targetType;
  const logs = await AdminLog.find(filter)
    .populate('admin', 'username efootballUsername email')
    .sort({ createdAt: -1 })
    .limit(limit);
  res.json({ logs });
}));

// Recherche avancée utilisateurs avec filtres
adminRouter.get('/users/search', asyncHandler(async (req, res) => {
  const { q, status, minEarnings, maxReports, sortBy = 'createdAt', order = 'desc' } = req.query;

  const filter = {};

  // Recherche textuelle (username, email, efootballUsername)
  if (q) {
    const regex = new RegExp(q, 'i');
    filter.$or = [
      { username: regex },
      { email: regex },
      { efootballUsername: regex }
    ];
  }

  // Filtre par statut (banni/actif)
  if (status === 'banned') filter.isBanned = true;
  if (status === 'active') filter.isBanned = { $ne: true };

  // Filtre par gains minimum
  if (minEarnings) {
    filter.totalEarnings = { $gte: Number(minEarnings) };
  }

  // Filtre par nombre de signalements
  if (maxReports) {
    filter.reportsCount = { $lte: Number(maxReports) };
  }

  const sortOrder = order === 'asc' ? 1 : -1;
  const sortField = ['createdAt', 'totalEarnings', 'wins', 'reportsCount'].includes(sortBy) ? sortBy : 'createdAt';

  const users = await User.find(filter)
    .select('-passwordHash')
    .sort({ [sortField]: sortOrder })
    .limit(100);

  // Récupérer les wallets associés
  const userIds = users.map(u => u._id);
  const wallets = await Wallet.find({ user: { $in: userIds } });

  // Associer wallets aux users
  const usersWithWallets = users.map(user => {
    const wallet = wallets.find(w => String(w.user) === String(user._id));
    return {
      ...user.toObject(),
      wallet: wallet || null
    };
  });

  res.json({
    users: usersWithWallets,
    count: users.length,
    filters: { q, status, minEarnings, maxReports }
  });
}));

// Get détails d'un litige avec comparaison des scores
adminRouter.get('/disputes/:id/details', asyncHandler(async (req, res) => {
  requireObjectId(req.params.id, 'Identifiant de litige invalide');

  const duel = await Duel.findById(req.params.id)
    .populate('player1 player2', 'username efootballUsername email country wins losses totalEarnings')
    .populate('winner loser', 'username efootballUsername');

  if (!duel) throw new AppError('Duel non trouvé', 404);
  if (duel.status !== 'dispute') {
    return res.json({
      duel,
      warning: 'Ce duel n\'est pas en statut litige',
      resultPlayer1: duel.resultPlayer1,
      resultPlayer2: duel.resultPlayer2
    });
  }

  // Analyser les résultats
  const result1 = duel.resultPlayer1;
  const result2 = duel.resultPlayer2;

  let comparison = null;
  if (result1 && result2) {
    const score1 = { myScore: result1.myScore, opponentScore: result1.opponentScore };
    const score2 = { myScore: result2.myScore, opponentScore: result2.opponentScore };

    // Vérifier cohérence
    const scoresMatch = score1.myScore === score2.opponentScore && score1.opponentScore === score2.myScore;
    const declaredWinnersMatch = result1.declaredWinner === result2.declaredWinner;

    comparison = {
      player1: score1,
      player2: score2,
      scoresMatch,
      declaredWinnersMatch,
      suggestedWinner: scoresMatch && declaredWinnersMatch ? result1.declaredWinner : null,
      conflict: !scoresMatch || !declaredWinnersMatch
    };
  }

  res.json({
    duel,
    resultPlayer1: result1,
    resultPlayer2: result2,
    comparison,
    disputeReason: duel.disputeReason,
    autoValidationStatus: duel.autoValidationStatus,
    suggestedAction: comparison?.suggestedWinner ? 'validate_winner' : 'manual_review'
  });
}));

// Export des données (CSV-ready)
adminRouter.get('/export/duels', asyncHandler(async (req, res) => {
  const { from, to, status } = req.query;
  const filter = {};

  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  if (status) filter.status = status;

  const duels = await Duel.find(filter)
    .populate('player1 player2 winner', 'username efootballUsername email')
    .sort({ createdAt: -1 });

  // Format pour export
  const exportData = duels.map(d => ({
    id: d._id,
    date: d.createdAt,
    player1: d.player1?.username || 'N/A',
    player2: d.player2?.username || 'N/A',
    winner: d.winner?.username || 'N/A',
    amount: d.amount,
    potTotal: d.potTotal,
    commissionAmount: d.commissionAmount,
    winnerAmount: d.winnerAmount,
    status: d.status,
    scorePlayer1: d.resultPlayer1?.score || 'N/A',
    scorePlayer2: d.resultPlayer2?.score || 'N/A'
  }));

  res.json({
    data: exportData,
    count: exportData.length,
    period: { from, to }
  });
}));

adminRouter.post('/challenges/cleanup-open', asyncHandler(async (req, res) => {
  const note = String(req.body.note || 'Nettoyage admin via panneau').trim();
  const result = await cancelOpenChallenges(req.user._id, { note });
  if (result.count) {
    await notifyAdmins('admin:challenge_cleanup', {
      count: result.count,
      challengeIds: result.challengeIds
    });
  }
  res.json({
    cleaned: result.count,
    challengeIds: result.challengeIds || []
  });
}));

// ============================================
// SYSTÈME DE RÉINITIALISATION CONTRÔLÉE
// ============================================

// Stockage temporaire des confirmations (en prod: Redis)
const pendingResets = new Map();

// Étape 1: Demander la réinitialisation (génère backup + code de confirmation)
adminRouter.post('/wallets/request-reset', protect, requireAdmin, asyncHandler(async (req, res) => {
  const { reason } = req.body;

  if (!reason || reason.length < 10) {
    throw new AppError('Une raison détaillée est requise (min 10 caractères)', 400);
  }

  // 1. CRÉER UN BACKUP COMPLET AVANT TOUTE ACTION
  const backupTimestamp = new Date().toISOString();
  const walletsBefore = await Wallet.find({}).lean();

  // Calculer les totaux avant
  const totalsBefore = walletsBefore.reduce((acc, w) => ({
    available: acc.available + (w.balanceAvailable || 0),
    locked: acc.locked + (w.balanceLocked || 0),
    total: acc.total + (w.balanceTotal || 0),
    count: acc.count + 1
  }), { available: 0, locked: 0, total: 0, count: 0 });

  // 2. GÉNÉRER CODE DE CONFIRMATION (6 chiffres)
  const confirmationCode = Math.floor(100000 + Math.random() * 900000).toString();

  // 3. STOCKER LA DEMANDE (expire dans 10 minutes)
  const resetRequest = {
    adminId: req.user._id,
    adminEmail: req.user.email,
    reason,
    backupTimestamp,
    walletsBefore,
    totalsBefore,
    confirmationCode,
    createdAt: Date.now(),
    expiresAt: Date.now() + 10 * 60 * 1000 // 10 min
  };

  const requestId = `reset_${Date.now()}_${req.user._id}`;
  pendingResets.set(requestId, resetRequest);

  // 4. LOGGER L'ACTION
  await AdminLog.create({
    admin: req.user._id,
    action: 'WALLET_RESET_REQUESTED',
    targetType: 'wallets',
    targetId: 'ALL',
    details: {
      reason,
      requestId,
      totalsBefore,
      walletsCount: totalsBefore.count
    }
  });

  // 5. NOTIFIER LES AUTRES ADMINS
  await notifyAdmins('admin:critical_action', {
    type: 'wallet_reset_requested',
    adminUsername: req.user.username,
    reason,
    totalsBefore,
    requestId,
    message: `🚨 ACTION CRITIQUE: ${req.user.username} demande la réinitialisation de ${totalsBefore.count} comptes`
  });

  res.json({
    success: true,
    message: 'Demande de réinitialisation créée. Backup effectué.',
    requestId,
    summary: {
      walletsCount: totalsBefore.count,
      totalAvailable: totalsBefore.available,
      totalLocked: totalsBefore.locked,
      totalAll: totalsBefore.total
    },
    confirmationRequired: true,
    confirmationCodeHint: `Code envoyé à ${req.user.email}`, // En prod: envoyer vraiment l'email
    expiresIn: '10 minutes'
  });
}));

// Étape 2: Confirmer avec le code
adminRouter.post('/wallets/confirm-reset', protect, requireAdmin, asyncHandler(async (req, res) => {
  const { requestId, confirmationCode, doubleConfirm } = req.body;

  // Vérifier la demande existe
  const request = pendingResets.get(requestId);
  if (!request) {
    throw new AppError('Demande invalide ou expirée', 400);
  }

  // Vérifier expiration
  if (Date.now() > request.expiresAt) {
    pendingResets.delete(requestId);
    throw new AppError('La demande a expiré (10 minutes). Recommencez.', 400);
  }

  // Vérifier que c'est le même admin
  if (String(request.adminId) !== String(req.user._id)) {
    throw new AppError('Seul l\'admin ayant initié la demande peut la confirmer', 403);
  }

  // Vérifier le code
  if (request.confirmationCode !== confirmationCode) {
    throw new AppError('Code de confirmation invalide', 400);
  }

  // Double confirmation requise
  if (!doubleConfirm || doubleConfirm !== 'RESET_ALL_WALLETS_CONFIRMED') {
    throw new AppError('Double confirmation requise. Ajoutez doubleConfirm: "RESET_ALL_WALLETS_CONFIRMED"', 400);
  }

  // ============================================
  // EXÉCUTION DE LA RÉINITIALISATION
  // ============================================

  const session = await mongoose.startSession();
  let resetResults = null;

  try {
    await session.withTransaction(async () => {
      // Mettre à jour tous les wallets à 0
      const updateResult = await Wallet.updateMany(
        {},
        {
          $set: {
            balanceAvailable: 0,
            balanceLocked: 0,
            balanceTotal: 0
          }
        },
        { session }
      );

      // Créer des transactions d'ajustement pour traçabilité
      const adjustmentTransactions = request.walletsBefore
        .filter(w => w.balanceAvailable > 0 || w.balanceLocked > 0)
        .map(w => ({
          wallet: w._id,
          user: w.user,
          type: 'admin_reset',
          amount: -(w.balanceAvailable + w.balanceLocked),
          description: `Réinitialisation admin par ${req.user.username} - Raison: ${request.reason}`,
          status: 'completed',
          referenceId: requestId,
          createdAt: new Date()
        }));

      if (adjustmentTransactions.length > 0) {
        await Transaction.insertMany(adjustmentTransactions, { session });
      }

      resetResults = {
        walletsModified: updateResult.modifiedCount,
        walletsMatched: updateResult.matchedCount,
        transactionsCreated: adjustmentTransactions.length
      };
    });

    // Netoyer la demande
    pendingResets.delete(requestId);

    // Logger l'action complétée
    await AdminLog.create({
      admin: req.user._id,
      action: 'WALLET_RESET_EXECUTED',
      targetType: 'wallets',
      targetId: 'ALL',
      details: {
        requestId,
        reason: request.reason,
        results: resetResults,
        totalsBefore: request.totalsBefore,
        backupTimestamp: request.backupTimestamp
      }
    });

    // Notification aux admins
    await notifyAdmins('admin:critical_action_completed', {
      type: 'wallet_reset_executed',
      adminUsername: req.user.username,
      reason: request.reason,
      results: resetResults,
      message: `⚠️ RÉINITIALISATION EXÉCUTÉE: ${resetResults.walletsModified} comptes mis à 0 par ${req.user.username}`
    });

    res.json({
      success: true,
      message: 'Réinitialisation exécutée avec succès',
      results: resetResults,
      summary: {
        walletsReset: resetResults.walletsModified,
        totalEmptied: request.totalsBefore.total,
        transactionsLogged: resetResults.transactionsCreated
      },
      warning: 'Cette action est irréversible. Un backup a été créé avant l\'action.'
    });

  } catch (error) {
    await session.abortTransaction();
    throw new AppError(`Échec de la réinitialisation: ${error.message}`, 500);
  } finally {
    session.endSession();
  }
}));

// Étape 3: Vérifier le statut d'une demande
adminRouter.get('/wallets/reset-status/:requestId', protect, requireAdmin, asyncHandler(async (req, res) => {
  const request = pendingResets.get(req.params.requestId);

  if (!request) {
    return res.json({ status: 'expired_or_completed', message: 'Demande expirée ou déjà traitée' });
  }

  res.json({
    status: 'pending',
    createdAt: new Date(request.createdAt),
    expiresAt: new Date(request.expiresAt),
    remainingSeconds: Math.floor((request.expiresAt - Date.now()) / 1000),
    totalsBefore: request.totalsBefore,
    reason: request.reason
  });
}));

// Annuler une demande en attente
adminRouter.post('/wallets/cancel-reset', protect, requireAdmin, asyncHandler(async (req, res) => {
  const { requestId } = req.body;
  const request = pendingResets.get(requestId);

  if (!request) {
    throw new AppError('Demande introuvable', 404);
  }

  if (String(request.adminId) !== String(req.user._id)) {
    throw new AppError('Non autorisé', 403);
  }

  pendingResets.delete(requestId);

  await AdminLog.create({
    admin: req.user._id,
    action: 'WALLET_RESET_CANCELLED',
    targetType: 'wallets',
    targetId: 'ALL',
    details: { requestId, reason: request.reason }
  });

  res.json({ success: true, message: 'Demande annulée' });
}));
