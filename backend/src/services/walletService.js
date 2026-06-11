import mongoose from 'mongoose';
import { Transaction } from '../models/Transaction.js';
import { Wallet } from '../models/Wallet.js';
import { Withdrawal } from '../models/Withdrawal.js';
import { AppError } from '../utils/AppError.js';
import { logCriticalAction, logError } from './auditLogService.js';
import { notifyAdmins, notifyUser } from './notificationService.js';
import { notifyWalletTransaction } from '../bot/telegramBot.js';
import { User } from '../models/User.js';

function assertPositiveFiniteAmount(amount, message) {
  const numericAmount = Math.round(Number(amount) * 100) / 100; // Fix floating point
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new AppError(message, 422);
  }
  return numericAmount;
}

function normalizeWithdrawalMethod(method) {
  const value = String(method || '').trim();
  if (!value) return '';

  const lowered = value.toLowerCase();
  if (lowered === 'wave') return 'wave';
  if (lowered === 'mtn' || lowered === 'mtn mobile money') return 'mtn';
  if (lowered === 'mobile money') return 'Mobile Money';
  if (lowered === 'crypto') return 'Crypto';
  if (lowered === 'bank') return 'Bank';
  if (lowered === 'manual') return 'Manual';
  return '';
}

async function evaluateWithdrawalFraudSignals({ userId, amount, method, phoneOrWallet }) {
  const since24h = new Date(Date.now() - (24 * 60 * 60 * 1000));
  const since7d = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));
  const flags = [];
  let score = 0;

  const [recentWithdrawals, sharedDestinationCount] = await Promise.all([
    Withdrawal.countDocuments({ user: userId, createdAt: { $gte: since24h } }),
    Withdrawal.countDocuments({
      user: { $ne: userId },
      phoneOrWallet,
      method,
      createdAt: { $gte: since7d }
    })
  ]);

  if (recentWithdrawals >= 2) {
    flags.push('withdrawal_frequency_24h');
    score += 25;
  }
  if (sharedDestinationCount >= 1) {
    flags.push('shared_withdrawal_destination');
    score += 30;
  }
  if (Number(amount) >= 75000) {
    flags.push('high_amount_withdrawal');
    score += 15;
  }

  return { fraudScore: Math.min(score, 100), fraudFlags: flags };
}

export async function ensureWallet(userId, session = null) {
  return Wallet.findOneAndUpdate(
    { user: userId },
    { $setOnInsert: { user: userId } },
    { new: true, upsert: true, session, setDefaultsOnInsert: true }
  );
}

export async function getWalletsByUserIds(userIds, session = null) {
  const uniqueIds = [...new Set(
    (userIds || [])
      .filter(Boolean)
      .map((id) => String(id))
  )];

  if (!uniqueIds.length) return new Map();

  const wallets = await Wallet.find({ user: { $in: uniqueIds } }).session(session);
  return new Map(wallets.map((wallet) => [String(wallet.user), wallet.toObject()]));
}

export async function attachWalletsToUsers(users, session = null) {
  const list = Array.isArray(users) ? users : [users];
  const walletsByUserId = await getWalletsByUserIds(list.map((user) => user?._id || user?.id), session);

  return list.map((user) => {
    if (!user) return user;
    const source = user.toObject ? user.toObject() : { ...user };
    const wallet = walletsByUserId.get(String(source._id)) || null;
    return { ...source, wallet };
  });
}

export async function createTransaction(data, session = null) {
  return Transaction.create([data], { session }).then((docs) => docs[0]);
}

export async function deposit(userId, amount, description = 'Simulated deposit') {
  const numericAmount = assertPositiveFiniteAmount(amount, 'Le montant du dépôt doit être positif');

  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const wallet = await ensureWallet(userId, session);
      // Use atomic operations to prevent race conditions
      await Wallet.updateOne(
        { _id: wallet._id },
        {
          $inc: {
            balanceAvailable: numericAmount,
            balanceTotal: numericAmount,
            totalDeposited: numericAmount
          }
        },
        { session }
      );

      const transaction = await createTransaction({ user: userId, type: 'deposit', amount: numericAmount, description }, session);

      await logCriticalAction('wallet:deposit', userId, { amount: numericAmount, transactionId: transaction._id });

      return wallet;
    });
  } catch (error) {
    await logError('wallet:deposit', userId, error.message, { amount: numericAmount });
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function requestWithdrawal(userId, { amount, method, phoneOrWallet }) {
  const numericAmount = assertPositiveFiniteAmount(amount, 'Le montant du retrait doit être positif');
  const normalizedMethod = normalizeWithdrawalMethod(method);
  if (!normalizedMethod) throw new AppError('La méthode de retrait est invalide', 422);

  const feeRate = numericAmount >= 50000 ? 0.02 : 0.03;
  const feeAmount = Math.round(numericAmount * feeRate);
  const netAmount = numericAmount - feeAmount;
  const fraudAssessment = await evaluateWithdrawalFraudSignals({
    userId,
    amount: numericAmount,
    method: normalizedMethod,
    phoneOrWallet
  });

  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const wallet = await ensureWallet(userId, session);
      if (wallet.balanceAvailable < numericAmount) throw new AppError('Solde disponible insuffisant', 422);

      wallet.balanceAvailable -= numericAmount;
      wallet.balanceTotal = wallet.balanceAvailable + wallet.balanceLocked;
      wallet.totalWithdrawn += numericAmount;
      await wallet.save({ session });

      const withdrawal = await Withdrawal.create(
        [{
          user: userId,
          amount: numericAmount,
          feeRate,
          feeAmount,
          netAmount,
          method: normalizedMethod,
          phoneOrWallet,
          fraudScore: fraudAssessment.fraudScore,
          fraudFlags: fraudAssessment.fraudFlags
        }],
        { session }
      ).then((docs) => docs[0]);

      await createTransaction(
        {
          user: userId,
          type: 'withdraw',
          amount: numericAmount,
          status: 'pending',
          referenceId: withdrawal._id,
          description: `Demande de retrait via ${normalizedMethod}`
        },
        session
      );

      await logCriticalAction('wallet:withdraw_request', userId, {
        amount: numericAmount,
        method: normalizedMethod,
        withdrawalId: withdrawal._id
      });

      return withdrawal;
    });
  } finally {
    await session.endSession();
  }
}

export async function sendWithdrawalRequestNotifications(withdrawal) {
  if (!withdrawal?._id || !withdrawal?.user) return;
  try {
    await notifyUser(withdrawal.user, 'withdrawal:submitted', {
      withdrawalId: withdrawal._id,
      amount: withdrawal.amount,
      method: withdrawal.method
    });
    await notifyUser(withdrawal.user, 'withdrawal:processing', {
      withdrawalId: withdrawal._id,
      amount: withdrawal.amount,
      method: withdrawal.method
    });
    await notifyUser(withdrawal.user, 'withdrawal:review_required', {
      withdrawalId: withdrawal._id,
      amount: withdrawal.amount,
      method: withdrawal.method
    });
    await notifyAdmins('admin:withdrawal_pending', {
      withdrawalId: withdrawal._id,
      amount: withdrawal.amount,
      method: withdrawal.method,
      userId: withdrawal.user,
      fraudScore: withdrawal.fraudScore,
      fraudFlags: withdrawal.fraudFlags
    });
    if (withdrawal.fraudScore >= 40) {
      await notifyAdmins('security:withdrawal_suspicious', {
        withdrawalId: withdrawal._id,
        amount: withdrawal.amount,
        method: withdrawal.method,
        userId: withdrawal.user,
        fraudScore: withdrawal.fraudScore,
        fraudFlags: withdrawal.fraudFlags
      });
    }
  } catch (error) {
    await logError('wallet:withdraw_notification_failed', withdrawal.user, error.message, {
      withdrawalId: withdrawal._id,
      amount: withdrawal.amount,
      method: withdrawal.method
    });
  }
}

export async function lockStake(userId, amount, referenceId, session) {
  const wallet = await ensureWallet(userId, session);
  if (wallet.balanceAvailable < amount) throw new AppError('Solde disponible insuffisant', 422);

  wallet.balanceAvailable -= amount;
  wallet.balanceLocked += amount;
  wallet.balanceTotal = wallet.balanceAvailable + wallet.balanceLocked;
  await wallet.save({ session });

  await createTransaction(
    { user: userId, type: 'challenge_lock', amount, referenceId, description: 'Mise bloquée pour duel' },
    session
  );
  return wallet;
}

export async function refundStake(userId, amount, referenceId, session) {
  const wallet = await ensureWallet(userId, session);
  wallet.balanceLocked = Math.max(wallet.balanceLocked - amount, 0);
  wallet.balanceAvailable += amount;
  wallet.balanceTotal = wallet.balanceAvailable + wallet.balanceLocked;
  await wallet.save({ session });

  await createTransaction(
    { user: userId, type: 'challenge_refund', amount, referenceId, description: 'Mise remboursée' },
    session
  );
}

export async function settleDuelWallets({ winnerId, loserId, stake, winnerAmount, commissionAmount, duelId }, session) {
  console.log('[settleDuelWallets] Starting settlement:', { winnerId, loserId, stake, winnerAmount, commissionAmount, duelId });
  const winnerWallet = await ensureWallet(winnerId, session);
  const loserWallet = await ensureWallet(loserId, session);

  console.log('[settleDuelWallets] Before - Winner:', { locked: winnerWallet.balanceLocked, available: winnerWallet.balanceAvailable, total: winnerWallet.balanceTotal });
  console.log('[settleDuelWallets] Before - Loser:', { locked: loserWallet.balanceLocked, available: loserWallet.balanceAvailable, total: loserWallet.balanceTotal });

  winnerWallet.balanceLocked = Math.max(winnerWallet.balanceLocked - stake, 0);
  loserWallet.balanceLocked = Math.max(loserWallet.balanceLocked - stake, 0);
  winnerWallet.balanceAvailable += winnerAmount;
  winnerWallet.balanceTotal = winnerWallet.balanceAvailable + winnerWallet.balanceLocked;
  loserWallet.balanceTotal = loserWallet.balanceAvailable + loserWallet.balanceLocked;
  winnerWallet.totalWon += winnerAmount;
  loserWallet.totalLost += stake;

  console.log('[settleDuelWallets] After - Winner:', { locked: winnerWallet.balanceLocked, available: winnerWallet.balanceAvailable, total: winnerWallet.balanceTotal });
  console.log('[settleDuelWallets] After - Loser:', { locked: loserWallet.balanceLocked, available: loserWallet.balanceAvailable, total: loserWallet.balanceTotal });

  await winnerWallet.save({ session });
  await loserWallet.save({ session });

  const winTransaction = await createTransaction(
    { user: winnerId, type: 'duel_win', amount: winnerAmount, referenceId: duelId, description: 'Gains de duel crédités' },
    session
  );
  await createTransaction(
    { user: loserId, type: 'duel_loss', amount: stake, referenceId: duelId, description: 'Mise de duel perdue' },
    session
  );
  await createTransaction(
    { type: 'commission', amount: commissionAmount, referenceId: duelId, description: 'Commission de duel plateforme' },
    session
  );
  await notifyUser(winnerId, 'duel:payment_released', {
    duelId,
    amount: winnerAmount
  });

  // Notifications Telegram pour les transactions wallet
  try {
    const winnerUser = await User.findById(winnerId).select('telegramId notificationPreferences');
    const loserUser = await User.findById(loserId).select('telegramId notificationPreferences');

    if (winnerUser?.telegramId && winnerUser.notificationPreferences?.telegram?.wallet !== false) {
      await notifyWalletTransaction(winnerUser.telegramId, 'win', winnerAmount, winnerWallet.balanceAvailable);
    }
    if (loserUser?.telegramId && loserUser.notificationPreferences?.telegram?.wallet !== false) {
      await notifyWalletTransaction(loserUser.telegramId, 'loss', stake, loserWallet.balanceAvailable);
    }
  } catch (error) {
    console.error('[Telegram] Wallet notification error:', error);
  }

  await notifyAdmins('admin:duel_settled', {
    duelId,
    winnerId,
    loserId,
    winnerAmount,
    commissionAmount
  });

  // Log audit for duel settlement
  await logCriticalAction('wallet:duel_settlement', winnerId, {
    duelId,
    winnerAmount,
    commissionAmount,
    winTransactionId: winTransaction._id
  });
}

export async function adjustBalance(userId, amount, description, session, operation = 'add') {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new AppError('Le montant de l\'ajustement est invalide', 422);
  }

  const normalizedOperation = String(operation || '').toLowerCase();
  const delta = normalizedOperation === 'subtract' || normalizedOperation === 'remove' || normalizedOperation === 'deduct'
    ? -numericAmount
    : numericAmount;

  const wallet = await ensureWallet(userId, session);
  wallet.balanceAvailable += delta;
  if (wallet.balanceAvailable < 0) throw new AppError('L\'ajustement créerait un solde négatif', 422);
  wallet.balanceTotal = wallet.balanceAvailable + wallet.balanceLocked;
  await wallet.save({ session });

  await createTransaction(
    { user: userId, type: 'admin_adjustment', amount: delta, description },
    session
  );
  return wallet;
}

export async function getWalletByUser(userId) {
  return await ensureWallet(userId);
}

export async function lockFunds(userId, amount, session = null) {
  return await lockStake(userId, amount, null, session);
}

export async function unlockFunds(userId, amount, session = null) {
  const wallet = await ensureWallet(userId, session);
  wallet.balanceLocked = Math.max(wallet.balanceLocked - amount, 0);
  wallet.balanceAvailable += amount;
  wallet.balanceTotal = wallet.balanceAvailable + wallet.balanceLocked;
  await wallet.save({ session });

  await createTransaction(
    { user: userId, type: 'challenge_refund', amount, referenceId: null, description: 'Fonds déblocqués' },
    session
  );
}

export async function creditWallet(userId, amount, type, referenceId, description, session = null) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new AppError('Le montant doit être positif', 422);
  }

  const wallet = await ensureWallet(userId, session);
  wallet.balanceAvailable += numericAmount;
  wallet.balanceTotal = wallet.balanceAvailable + wallet.balanceLocked;
  await wallet.save({ session });

  await createTransaction(
    { user: userId, type, amount: numericAmount, referenceId, description },
    session
  );
}

export async function debitWallet(userId, amount, type, referenceId, description, session = null) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new AppError('Le montant doit être positif', 422);
  }

  const wallet = await ensureWallet(userId, session);
  if (wallet.balanceAvailable < numericAmount) {
    throw new AppError('Solde disponible insuffisant', 422);
  }

  wallet.balanceAvailable -= numericAmount;
  wallet.balanceTotal = wallet.balanceAvailable + wallet.balanceLocked;
  await wallet.save({ session });

  await createTransaction(
    { user: userId, type, amount: numericAmount, referenceId, description },
    session
  );
}
