import mongoose from 'mongoose';
import { AdminLog } from '../models/AdminLog.js';
import { Deposit } from '../models/Deposit.js';
import { Transaction } from '../models/Transaction.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { notifyUser } from './notificationService.js';
import { ensureWallet } from './walletService.js';

const MAX_PENDING_DEPOSITS = 3;
const MAX_SCREENSHOT_BYTES = 750 * 1024;
const PHONE_PATTERN = /^[+\d][\d\s().-]{6,24}$/;

function validateScreenshotDataUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('data:image/')) {
    throw new AppError('La capture de paiement doit être une image', 422);
  }
  const [header, data] = value.split(',');
  if (!header || !data || !/;base64$/i.test(header)) {
    throw new AppError('Format de capture invalide', 422);
  }
  const estimatedBytes = Math.ceil((data.length * 3) / 4);
  if (estimatedBytes > MAX_SCREENSHOT_BYTES) {
    throw new AppError('La capture est trop volumineuse. Taille maximale 750KB', 422);
  }
}

export async function createManualDeposit(userId, payload) {
  const method = String(payload.method || '').toLowerCase();
  const amount = Number(payload.amount);
  const senderName = String(payload.senderName || payload.sender_name || '').trim();
  const senderPhone = String(payload.senderPhone || payload.sender_phone || '').trim();
  const transactionReference = String(payload.transactionReference || payload.transaction_reference || '').trim();
  const screenshotUrl = payload.screenshotUrl || payload.screenshot_url;

  if (!['wave', 'mtn'].includes(method)) throw new AppError('La méthode de dépôt doit être wave ou mtn', 422);
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError('Le montant du dépôt doit être positif', 422);
  if (senderName.length < 2) throw new AppError('Le nom de l\'expéditeur est requis', 422);
  if (!PHONE_PATTERN.test(senderPhone)) throw new AppError('Format de téléphone invalide', 422);
  validateScreenshotDataUrl(screenshotUrl);

  const [pendingCount, recentRejected] = await Promise.all([
    Deposit.countDocuments({ user: userId, status: 'pending' }),
    Deposit.countDocuments({
      user: userId,
      status: 'rejected',
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    })
  ]);

  if (pendingCount >= MAX_PENDING_DEPOSITS) {
    throw new AppError('Vous avez déjà trop de dépôts en attente', 429);
  }
  if (recentRejected >= 5) {
    await User.findByIdAndUpdate(userId, { $inc: { reportsCount: 1 }, status: 'busy' });
    throw new AppError('Révision de dépôt bloquée après rejets répétés. Contactez le support.', 403);
  }

  return Deposit.create({
    user: userId,
    method,
    amount,
    senderName,
    senderPhone,
    transactionReference,
    screenshotUrl,
    status: 'pending'
  });
}

export async function approveManualDeposit(depositId, adminId, adminNote = '') {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const deposit = await Deposit.findById(depositId).session(session);
      if (!deposit) throw new AppError('Dépôt non trouvé', 404);
      if (deposit.status !== 'pending') throw new AppError('Dépôt déjà traité', 422);

      const wallet = await ensureWallet(deposit.user, session);
      wallet.balanceAvailable += deposit.amount;
      wallet.balanceTotal += deposit.amount;
      wallet.totalDeposited += deposit.amount;
      await wallet.save({ session });

      deposit.status = 'approved';
      deposit.adminNote = adminNote;
      deposit.approvedAt = new Date();
      deposit.approvedBy = adminId;
      await deposit.save({ session });

      await Transaction.create([{
        user: deposit.user,
        type: 'deposit',
        amount: deposit.amount,
        status: 'success',
        referenceId: deposit._id,
        description: `Dépôt manuel ${deposit.method.toUpperCase()} approuvé`,
        metadata: { senderPhone: deposit.senderPhone, transactionReference: deposit.transactionReference }
      }], { session });

      await AdminLog.create([{
        admin: adminId,
        action: 'deposit_approved',
        targetType: 'Deposit',
        targetId: deposit._id,
        note: adminNote,
        metadata: { amount: deposit.amount, method: deposit.method }
      }], { session });

      notifyUser(deposit.user, 'deposit:approved', { depositId: deposit._id, amount: deposit.amount });
      return deposit;
    });
  } finally {
    await session.endSession();
  }
}

export async function rejectManualDeposit(depositId, adminId, adminNote = '') {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const deposit = await Deposit.findById(depositId).session(session);
      if (!deposit) throw new AppError('Dépôt non trouvé', 404);
      if (deposit.status !== 'pending') throw new AppError('Dépôt déjà traité', 422);

      deposit.status = 'rejected';
      deposit.adminNote = adminNote || 'Payment proof rejected';
      await deposit.save({ session });

      const rejectedCount = await Deposit.countDocuments({
        user: deposit.user,
        status: 'rejected',
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      }).session(session);

      if (rejectedCount >= 3) {
        await User.updateOne({ _id: deposit.user }, { $inc: { reportsCount: 1 } }).session(session);
      }

      await AdminLog.create([{
        admin: adminId,
        action: 'deposit_rejected',
        targetType: 'Deposit',
        targetId: deposit._id,
        note: deposit.adminNote,
        metadata: { amount: deposit.amount, method: deposit.method, rejectedCount }
      }], { session });

      notifyUser(deposit.user, 'deposit:rejected', { depositId: deposit._id, note: deposit.adminNote });
      return deposit;
    });
  } finally {
    await session.endSession();
  }
}
