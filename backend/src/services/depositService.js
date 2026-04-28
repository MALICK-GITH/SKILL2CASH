import mongoose from 'mongoose';
import { AdminLog } from '../models/AdminLog.js';
import { Deposit } from '../models/Deposit.js';
import { Transaction } from '../models/Transaction.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { notifyAdmins, notifyUser } from './notificationService.js';
import { analyzeDepositProof } from './depositProofService.js';
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

  const proofAnalysis = await analyzeDepositProof(screenshotUrl, {
    senderName,
    amount,
    method,
    transactionReference
  });

  const deposit = await Deposit.create({
    user: userId,
    method,
    amount,
    senderName,
    senderPhone,
    transactionReference,
    screenshotUrl,
    status: 'pending',
    autoVerificationStatus: proofAnalysis.status,
    autoVerificationReason: proofAnalysis.reason,
    ocrText: proofAnalysis.text,
    ocrConfidence: proofAnalysis.confidence,
    ocrDetectedSender: proofAnalysis.detectedSender,
    ocrDetectedAmount: proofAnalysis.detectedAmount,
    ocrDetectedReference: proofAnalysis.detectedReference,
    ocrAmountCandidates: proofAnalysis.amountCandidates
  });

  try {
    await notifyUser(userId, 'deposit:submitted', {
      depositId: deposit._id,
      amount,
      method,
      status: deposit.autoVerificationStatus
    });
    if (deposit.autoVerificationStatus === 'matched') {
      await notifyUser(userId, 'deposit:ocr_matched', {
        depositId: deposit._id,
        amount,
        method
      });
    } else if (deposit.autoVerificationStatus !== 'failed') {
      await notifyUser(userId, 'deposit:ocr_review_required', {
        depositId: deposit._id,
        amount,
        method,
        reason: deposit.autoVerificationReason
      });
    }
    await notifyAdmins('admin:deposit_pending', {
      depositId: deposit._id,
      amount,
      method,
      autoVerificationStatus: deposit.autoVerificationStatus,
      userId
    });
  } catch {}

  return deposit;
}

export async function approveManualDeposit(depositId, adminId, adminNote = '') {
  const session = await mongoose.startSession();
  try {
    const approvedDeposit = await session.withTransaction(async () => {
      const doc = await Deposit.findById(depositId).session(session);
      if (!doc) throw new AppError('Dépôt non trouvé', 404);
      if (doc.status !== 'pending') throw new AppError('Dépôt déjà traité', 422);

      const wallet = await ensureWallet(doc.user, session);
      wallet.balanceAvailable += doc.amount;
      wallet.balanceTotal = wallet.balanceAvailable + wallet.balanceLocked;
      wallet.totalDeposited += doc.amount;
      await wallet.save({ session });

      doc.status = 'approved';
      doc.adminNote = adminNote;
      doc.approvedAt = new Date();
      doc.approvedBy = adminId;
      await doc.save({ session });

      await Transaction.create([{
        user: doc.user,
        type: 'deposit',
        amount: doc.amount,
        status: 'success',
        referenceId: doc._id,
        description: `Dépôt manuel ${doc.method.toUpperCase()} approuvé`,
        metadata: { senderPhone: doc.senderPhone, transactionReference: doc.transactionReference }
      }], { session });

      await AdminLog.create([{
        admin: adminId,
        action: 'deposit_approved',
        targetType: 'Deposit',
        targetId: doc._id,
        note: adminNote,
        metadata: { amount: doc.amount, method: doc.method }
      }], { session });

      return doc;
    });
    try {
      await notifyUser(approvedDeposit.user, 'deposit:approved', { depositId: approvedDeposit._id, amount: approvedDeposit.amount });
    } catch {}
    return approvedDeposit;
  } finally {
    await session.endSession();
  }
}

export async function rejectManualDeposit(depositId, adminId, adminNote = '') {
  const session = await mongoose.startSession();
  try {
    const rejectedDeposit = await session.withTransaction(async () => {
      const doc = await Deposit.findById(depositId).session(session);
      if (!doc) throw new AppError('Dépôt non trouvé', 404);
      if (doc.status !== 'pending') throw new AppError('Dépôt déjà traité', 422);

      doc.status = 'rejected';
      doc.adminNote = adminNote || 'Payment proof rejected';
      await doc.save({ session });

      const rejectedCount = await Deposit.countDocuments({
        user: doc.user,
        status: 'rejected',
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      }).session(session);

      if (rejectedCount >= 3) {
        await User.updateOne({ _id: doc.user }, { $inc: { reportsCount: 1 } }).session(session);
      }

      await AdminLog.create([{
        admin: adminId,
        action: 'deposit_rejected',
        targetType: 'Deposit',
        targetId: doc._id,
        note: doc.adminNote,
        metadata: { amount: doc.amount, method: doc.method, rejectedCount }
      }], { session });

      return doc;
    });
    try {
      await notifyUser(rejectedDeposit.user, 'deposit:rejected', { depositId: rejectedDeposit._id, note: rejectedDeposit.adminNote });
    } catch {}
    return rejectedDeposit;
  } finally {
    await session.endSession();
  }
}

export async function autoApproveEligibleDeposits() {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000);
  const deposits = await Deposit.find({
    status: 'pending',
    autoVerificationStatus: 'matched',
    createdAt: { $lte: cutoff }
  }).sort({ createdAt: 1 }).limit(10);

  if (!deposits.length) return { processed: 0 };

  const admin = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });
  if (!admin) return { processed: 0 };

  let processed = 0;
  for (const deposit of deposits) {
    try {
      await approveManualDeposit(deposit._id, admin._id, 'Auto-validation OCR après 5 minutes');
      processed += 1;
    } catch {
      // Ignore races with manual admin actions.
    }
  }

  return { processed };
}
