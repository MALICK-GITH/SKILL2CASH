import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { AdminLog } from '../models/AdminLog.js';
import { Deposit } from '../models/Deposit.js';
import { Transaction } from '../models/Transaction.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { notifyAdmins, notifyUser } from './notificationService.js';
import { analyzeDepositPrefill, analyzeDepositProof } from './depositProofService.js';
import { ensureWallet } from './walletService.js';
import { enqueueDepositOcrJob } from '../queues/depositOcrQueue.js';
import { logAdminAction } from './auditLogService.js';

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

function buildScreenshotFingerprint(value) {
  const [, data = ''] = String(value || '').split(',');
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function evaluateDepositFraudSignals({ userId, amount, senderPhone, transactionReference, screenshotFingerprint }) {
  const since24h = new Date(Date.now() - (24 * 60 * 60 * 1000));
  const since7d = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));
  const flags = [];
  let score = 0;

  const [recentUserDeposits, recentRejected, duplicateFingerprintCount, duplicateReferenceCount, sharedPhoneCount] = await Promise.all([
    Deposit.countDocuments({ user: userId, createdAt: { $gte: since24h } }),
    Deposit.countDocuments({ user: userId, status: 'rejected', createdAt: { $gte: since7d } }),
    screenshotFingerprint ? Deposit.countDocuments({ screenshotFingerprint, createdAt: { $gte: since7d } }) : 0,
    transactionReference ? Deposit.countDocuments({ transactionReference, createdAt: { $gte: since7d } }) : 0,
    senderPhone ? Deposit.countDocuments({ senderPhone, user: { $ne: userId }, createdAt: { $gte: since7d } }) : 0
  ]);

  if (recentUserDeposits >= 3) {
    flags.push('deposit_frequency_24h');
    score += 25;
  }
  if (recentRejected >= 2) {
    flags.push('recent_rejected_deposits');
    score += 20;
  }
  if (duplicateFingerprintCount >= 1) {
    flags.push('duplicate_screenshot');
    score += 45;
  }
  if (duplicateReferenceCount >= 1) {
    flags.push('duplicate_transaction_reference');
    score += 35;
  }
  if (sharedPhoneCount >= 1) {
    flags.push('shared_sender_phone');
    score += 20;
  }
  if (Number(amount) >= 100000) {
    flags.push('high_amount_manual_review');
    score += 10;
  }

  return { fraudScore: Math.min(score, 100), fraudFlags: flags };
}

export async function processDepositProofReview(depositId) {
  const deposit = await Deposit.findById(depositId);
  if (!deposit || deposit.status !== 'pending') return null;

  const proofAnalysis = await analyzeDepositProof(deposit.screenshotUrl, {
    senderName: deposit.senderName,
    amount: deposit.amount,
    method: deposit.method,
    transactionReference: deposit.transactionReference
  });

  deposit.autoVerificationStatus = proofAnalysis.status;
  deposit.autoVerificationReason = proofAnalysis.reason;
  deposit.ocrText = proofAnalysis.text;
  deposit.ocrConfidence = proofAnalysis.confidence;
  deposit.ocrDetectedSender = proofAnalysis.detectedSender;
  deposit.ocrDetectedAmount = proofAnalysis.detectedAmount;
  deposit.ocrDetectedReference = proofAnalysis.detectedReference;
  deposit.ocrDetectedStatus = proofAnalysis.detectedStatus || '';
  if (!deposit.transactionReference && proofAnalysis.detectedReference) {
    deposit.transactionReference = proofAnalysis.detectedReference;
  }
  deposit.ocrAmountCandidates = proofAnalysis.amountCandidates;
  await deposit.save();

  if (proofAnalysis.status === 'matched') {
    await notifyUser(deposit.user, 'deposit:ocr_matched', {
      depositId: deposit._id,
      amount: deposit.amount,
      method: deposit.method
    });
    const systemAdmin = await User.findOne({ role: 'admin', isBanned: false }).sort({ createdAt: 1 }).select('_id');
    if (systemAdmin) {
      await approveManualDeposit(deposit._id, systemAdmin._id, 'Validation automatique OCR immédiate');
    }
  } else {
    await notifyUser(deposit.user, 'deposit:ocr_review_required', {
      depositId: deposit._id,
      amount: deposit.amount,
      method: deposit.method,
      reason: proofAnalysis.reason
    });
  }

  return deposit;
}

export async function processDepositOcrJob(depositId) {
  try {
    return await processDepositProofReview(depositId);
  } catch (error) {
    try {
      await Deposit.updateOne(
        { _id: depositId, status: 'pending' },
        {
          $set: {
            autoVerificationStatus: 'failed',
            autoVerificationReason: error.message || 'Erreur inconnue lors de l OCR dépôt'
          }
        }
      );
    } catch (updateError) {
      console.error('[depositService] Failed to update deposit OCR status:', updateError.message);
    }
    throw error;
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
  const screenshotFingerprint = buildScreenshotFingerprint(screenshotUrl);

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

  const fraudAssessment = await evaluateDepositFraudSignals({
    userId,
    amount,
    senderPhone,
    transactionReference,
    screenshotFingerprint
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
    autoVerificationStatus: 'pending',
    autoVerificationReason: 'OCR en file d attente',
    ocrText: '',
    ocrConfidence: 0,
    ocrDetectedSender: '',
    ocrDetectedAmount: '',
    ocrDetectedReference: '',
    ocrDetectedStatus: '',
    ocrAmountCandidates: [],
    screenshotFingerprint,
    fraudScore: fraudAssessment.fraudScore,
    fraudFlags: fraudAssessment.fraudFlags
  });

  void enqueueDepositOcrJob(deposit._id).catch(async (error) => {
    try {
      await processDepositOcrJob(deposit._id);
    } catch (fallbackError) {
      try {
        await Deposit.updateOne(
          { _id: deposit._id, status: 'pending' },
          {
            $set: {
              autoVerificationStatus: 'failed',
              autoVerificationReason: fallbackError.message || error.message || 'Impossible de traiter le dépôt OCR'
            }
          }
        );
      } catch (updateError) {
        console.error('[depositService] Failed to update deposit OCR fallback status:', updateError.message);
      }
    }
  });

  try {
    await notifyUser(userId, 'deposit:submitted', {
      depositId: deposit._id,
      amount,
      method,
      status: deposit.autoVerificationStatus
    });
    await notifyUser(userId, 'deposit:ocr_processing', {
      depositId: deposit._id,
      amount,
      method
    });
    await notifyAdmins('admin:deposit_pending', {
      depositId: deposit._id,
      amount,
      method,
      autoVerificationStatus: deposit.autoVerificationStatus,
      userId,
      fraudScore: deposit.fraudScore,
      fraudFlags: deposit.fraudFlags
    });
    if (deposit.fraudScore >= 40) {
      await notifyAdmins('security:deposit_suspicious', {
        depositId: deposit._id,
        amount,
        method,
        userId,
        fraudScore: deposit.fraudScore,
        fraudFlags: deposit.fraudFlags
      });
    }
  } catch (notifyError) {
    console.error('[depositService] Failed to send deposit notifications:', notifyError.message);
  }

  return deposit;
}

export async function previewDepositPrefill(userId, payload = {}) {
  const method = String(payload.method || '').toLowerCase();
  const screenshotUrl = payload.screenshotUrl || payload.screenshot_url;
  if (method && !['wave', 'mtn'].includes(method)) {
    throw new AppError('La méthode de dépôt doit être wave ou mtn', 422);
  }
  validateScreenshotDataUrl(screenshotUrl);
  const preview = await analyzeDepositPrefill(screenshotUrl, { method });
  return {
    userId,
    ...preview
  };
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
    await logAdminAction({
      adminId,
      action: 'deposit_approved',
      targetType: 'Deposit',
      targetId: approvedDeposit._id,
      note: adminNote,
      metadata: {
        amount: approvedDeposit.amount,
        method: approvedDeposit.method,
        fraudScore: approvedDeposit.fraudScore,
        fraudFlags: approvedDeposit.fraudFlags
      },
      afterState: {
        status: approvedDeposit.status,
        approvedAt: approvedDeposit.approvedAt,
        approvedBy: approvedDeposit.approvedBy
      }
    });
    try {
      await notifyUser(approvedDeposit.user, 'deposit:approved', { depositId: approvedDeposit._id, amount: approvedDeposit.amount });
    } catch (notifyError) {
      console.error('[depositService] Failed to notify user of approved deposit:', notifyError.message);
    }
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
    await logAdminAction({
      adminId,
      action: 'deposit_rejected',
      targetType: 'Deposit',
      targetId: rejectedDeposit._id,
      note: rejectedDeposit.adminNote,
      metadata: {
        amount: rejectedDeposit.amount,
        method: rejectedDeposit.method,
        fraudScore: rejectedDeposit.fraudScore,
        fraudFlags: rejectedDeposit.fraudFlags
      },
      afterState: {
        status: rejectedDeposit.status
      }
    });
    try {
      await notifyUser(rejectedDeposit.user, 'deposit:rejected', { depositId: rejectedDeposit._id, note: rejectedDeposit.adminNote });
    } catch (notifyError) {
      console.error('[depositService] Failed to notify user of rejected deposit:', notifyError.message);
    }
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
    } catch (approveError) {
      // Ignore races with manual admin actions.
      console.log('[depositService] Auto-approve race condition (expected):', approveError.message);
    }
  }

  return { processed };
}
