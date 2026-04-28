import mongoose from 'mongoose';
import { Notification } from '../models/Notification.js';
import { Duel } from '../models/Duel.js';
import { Wallet } from '../models/Wallet.js';
import { Withdrawal } from '../models/Withdrawal.js';
import { User } from '../models/User.js';
import { logCriticalAction, logError } from './auditLogService.js';
import { notifyUser } from './notificationService.js';

const STALE_ACTIVE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const STALE_REVIEW_TIMEOUT_MS = 24 * 60 * 60 * 1000;

function syncWalletTotal(wallet) {
  wallet.balanceTotal = wallet.balanceAvailable + wallet.balanceLocked;
}

async function refundStakedDuel(duel, session) {
  const wallet1 = await Wallet.findOne({ user: duel.player1 }).session(session);
  const wallet2 = await Wallet.findOne({ user: duel.player2 }).session(session);

  if (!wallet1 || !wallet2) return false;

  wallet1.balanceLocked = Math.max(wallet1.balanceLocked - duel.amount, 0);
  wallet1.balanceAvailable += duel.amount;
  syncWalletTotal(wallet1);

  wallet2.balanceLocked = Math.max(wallet2.balanceLocked - duel.amount, 0);
  wallet2.balanceAvailable += duel.amount;
  syncWalletTotal(wallet2);

  await wallet1.save({ session });
  await wallet2.save({ session });

  return true;
}

async function markDuelForManualReview(duel, session, reason, recoveryResults) {
  duel.status = 'dispute';
  duel.disputeReason = reason;
  duel.autoValidationStatus = 'manual_review';
  duel.autoValidationReason = reason;
  await duel.save({ session });

  recoveryResults.duelsRecovered++;
  await logCriticalAction('recovery:duel_escalated', duel.player1, {
    duelId: duel._id,
    reason,
    status: duel.status,
    amount: duel.amount
  });
}

/**
 * Service de récupération après crash
 * Récupère l'état des duels actifs et des fonds bloqués
 */
export async function recoverFromCrash() {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const recoveryResults = {
        duelsRecovered: 0,
        walletsRecovered: 0,
        errors: []
      };

      // 1. Récupérer les duels actifs depuis plus de 2 heures (crash potentiel)
      const staleActiveDuels = await Duel.find({
        status: 'active',
        startedAt: { $lt: new Date(Date.now() - STALE_ACTIVE_TIMEOUT_MS) }
      }).session(session);

      for (const duel of staleActiveDuels) {
        try {
          const refunded = await refundStakedDuel(duel, session);
          if (refunded) {
            duel.status = 'cancelled';
            duel.disputeReason = 'Auto-cancelled due to crash recovery';
            duel.finishedAt = new Date();
            await duel.save({ session });

            recoveryResults.duelsRecovered++;

            await logCriticalAction('recovery:duel_cancelled', duel.player1, {
              duelId: duel._id,
              reason: 'Crash recovery',
              amount: duel.amount
            });
          }
        } catch (error) {
          recoveryResults.errors.push({
            duelId: duel._id,
            error: error.message
          });
          await logError('recovery:duel_cancelled', duel.player1, error.message, { duelId: duel._id });
        }
      }

      // 2. Récupérer les duels bloqués dans les états de preuve/analyse depuis plus de 24h
      const staleReviewDuels = await Duel.find({
        status: { $in: ['waiting_player1_proof', 'waiting_player2_proof', 'analyzing', 'waiting_result', 'under_review'] },
        updatedAt: { $lt: new Date(Date.now() - STALE_REVIEW_TIMEOUT_MS) }
      }).session(session);

      for (const duel of staleReviewDuels) {
        try {
          const hasProofs = Boolean(duel.resultPlayer1 || duel.resultPlayer2);
          if (hasProofs) {
            await markDuelForManualReview(
              duel,
              session,
              'Auto-escalated during crash recovery after proof submission',
              recoveryResults
            );
            continue;
          }

          const refunded = await refundStakedDuel(duel, session);
          if (refunded) {
            duel.status = 'cancelled';
            duel.disputeReason = 'Auto-cancelled due to timeout (24h)';
            duel.finishedAt = new Date();
            await duel.save({ session });

            recoveryResults.duelsRecovered++;

            await logCriticalAction('recovery:duel_timeout', duel.player1, {
              duelId: duel._id,
              reason: '24h timeout',
              amount: duel.amount
            });
          }
        } catch (error) {
          recoveryResults.errors.push({
            duelId: duel._id,
            error: error.message
          });
          await logError('recovery:duel_timeout', duel.player1, error.message, { duelId: duel._id });
        }
      }

      // 3. Vérifier l'intégrité des wallets (balanceTotal = balanceAvailable + balanceLocked)
      const allWallets = await Wallet.find({ deletedAt: null }).session(session);
      for (const wallet of allWallets) {
        const expectedTotal = wallet.balanceAvailable + wallet.balanceLocked;
        if (wallet.balanceTotal !== expectedTotal) {
          const previousTotal = wallet.balanceTotal;
          wallet.balanceTotal = expectedTotal;
          await wallet.save({ session });
          recoveryResults.walletsRecovered++;
          
          await logCriticalAction('recovery:wallet_corrected', wallet.user, {
            walletId: wallet._id,
            oldTotal: previousTotal,
            newTotal: expectedTotal
          });
        }
      }

      await logCriticalAction('recovery:completed', null, recoveryResults);
      
      return recoveryResults;
    });
  } catch (error) {
    await logError('recovery:failed', null, error.message, {});
    throw error;
  } finally {
    await session.endSession();
  }
}

async function notificationExists(userId, type, withdrawalId) {
  return Boolean(await Notification.exists({
    user: userId,
    type,
    'metadata.withdrawalId': withdrawalId
  }));
}

export async function recoverMissingWithdrawalNotifications() {
  const withdrawals = await Withdrawal.find({ status: { $in: ['approved', 'paid', 'rejected'] } })
    .sort({ updatedAt: -1 })
    .limit(200);

  let replayed = 0;
  const errors = [];

  for (const withdrawal of withdrawals) {
    try {
      if (withdrawal.status === 'approved' || withdrawal.status === 'paid') {
        const approvedMissing = !(await notificationExists(withdrawal.user, 'withdrawal:approved', withdrawal._id));
        if (approvedMissing) {
          await notifyUser(withdrawal.user, 'withdrawal:approved', {
            withdrawalId: withdrawal._id,
            status: withdrawal.status
          });
          replayed += 1;
        }
      }

      if (withdrawal.status === 'paid') {
        const paidMissing = !(await notificationExists(withdrawal.user, 'withdrawal:paid', withdrawal._id));
        if (paidMissing) {
          await notifyUser(withdrawal.user, 'withdrawal:paid', {
            withdrawalId: withdrawal._id,
            amount: withdrawal.amount
          });
          replayed += 1;
        }
      }

      if (withdrawal.status === 'rejected') {
        const rejectedMissing = !(await notificationExists(withdrawal.user, 'withdrawal:rejected', withdrawal._id));
        if (rejectedMissing) {
          await notifyUser(withdrawal.user, 'withdrawal:rejected', {
            withdrawalId: withdrawal._id
          });
          replayed += 1;
        }
      }
    } catch (error) {
      errors.push({ withdrawalId: withdrawal._id, error: error.message });
      await logError('recovery:withdrawal_notification_failed', withdrawal.user, error.message, {
        withdrawalId: withdrawal._id,
        status: withdrawal.status
      });
    }
  }

  return { replayed, errors };
}

/**
 * Vérifier l'intégrité des données
 */
export async function checkDataIntegrity() {
  const integrityResults = {
    walletInconsistencies: 0,
    orphanedTransactions: 0,
    orphanedDuels: 0,
    details: []
  };

  // 1. Vérifier les wallets
  const wallets = await Wallet.find({ deletedAt: null });
  for (const wallet of wallets) {
    const expectedTotal = wallet.balanceAvailable + wallet.balanceLocked;
    if (wallet.balanceTotal !== expectedTotal) {
      integrityResults.walletInconsistencies++;
      integrityResults.details.push({
        type: 'wallet_inconsistency',
        walletId: wallet._id,
        userId: wallet.user,
        expected: expectedTotal,
        actual: wallet.balanceTotal
      });
    }
  }

  // 2. Vérifier les transactions orphelines (sans utilisateur valide)
  const { Transaction } = await import('../models/Transaction.js');
  const transactions = await Transaction.find({ user: { $ne: null } });
  for (const transaction of transactions) {
    const userExists = await User.exists({ _id: transaction.user, deletedAt: null });
    if (!userExists) {
      integrityResults.orphanedTransactions++;
      integrityResults.details.push({
        type: 'orphaned_transaction',
        transactionId: transaction._id,
        userId: transaction.user
      });
    }
  }

  // 3. Vérifier les duels orphelins (sans joueurs valides)
  const duels = await Duel.find({ status: { $ne: 'finished' } });
  for (const duel of duels) {
    const player1Exists = await User.exists({ _id: duel.player1, deletedAt: null });
    const player2Exists = await User.exists({ _id: duel.player2, deletedAt: null });
    if (!player1Exists || !player2Exists) {
      integrityResults.orphanedDuels++;
      integrityResults.details.push({
        type: 'orphaned_duel',
        duelId: duel._id,
        player1Exists,
        player2Exists
      });
    }
  }

  return integrityResults;
}
