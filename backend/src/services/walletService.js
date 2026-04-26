import mongoose from 'mongoose';
import { Transaction } from '../models/Transaction.js';
import { Wallet } from '../models/Wallet.js';
import { Withdrawal } from '../models/Withdrawal.js';
import { AppError } from '../utils/AppError.js';
import { logCriticalAction, logError } from './auditLogService.js';

export async function ensureWallet(userId, session = null) {
  let wallet = await Wallet.findOne({ user: userId }).session(session);
  if (!wallet) {
    wallet = await Wallet.create([{ user: userId }], { session }).then((docs) => docs[0]);
  }
  return wallet;
}

async function createTransaction(data, session = null) {
  return Transaction.create([data], { session }).then((docs) => docs[0]);
}

export async function deposit(userId, amount, description = 'Simulated deposit') {
  if (amount <= 0) throw new AppError('Le montant du dépôt doit être positif', 422);

  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const wallet = await ensureWallet(userId, session);
      wallet.balanceAvailable += amount;
      wallet.balanceTotal += amount;
      wallet.totalDeposited += amount;
      await wallet.save({ session });

      const transaction = await createTransaction({ user: userId, type: 'deposit', amount, description }, session);
      
      await logCriticalAction('wallet:deposit', userId, { amount, transactionId: transaction._id });
      
      return wallet;
    });
  } catch (error) {
    await logError('wallet:deposit', userId, error.message, { amount });
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function requestWithdrawal(userId, { amount, method, phoneOrWallet }) {
  if (amount <= 0) throw new AppError('Le montant du retrait doit être positif', 422);

  const feeRate = amount >= 50000 ? 0.02 : 0.03;
  const feeAmount = Math.round(amount * feeRate);
  const netAmount = amount - feeAmount;

  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const wallet = await ensureWallet(userId, session);
      if (wallet.balanceAvailable < amount) throw new AppError('Solde disponible insuffisant', 422);

      wallet.balanceAvailable -= amount;
      wallet.balanceTotal -= amount;
      wallet.totalWithdrawn += amount;
      await wallet.save({ session });

      const withdrawal = await Withdrawal.create(
        [{ user: userId, amount, feeRate, feeAmount, netAmount, method, phoneOrWallet }],
        { session }
      ).then((docs) => docs[0]);

      await createTransaction(
        {
          user: userId,
          type: 'withdraw',
          amount,
          status: 'pending',
          referenceId: withdrawal._id,
          description: `Demande de retrait via ${method}`
        },
        session
      );

      return withdrawal;
    });
  } finally {
    await session.endSession();
  }
}

export async function lockStake(userId, amount, referenceId, session) {
  const wallet = await ensureWallet(userId, session);
  if (wallet.balanceAvailable < amount) throw new AppError('Solde disponible insuffisant', 422);

  wallet.balanceAvailable -= amount;
  wallet.balanceLocked += amount;
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
  await wallet.save({ session });

  await createTransaction(
    { user: userId, type: 'challenge_refund', amount, referenceId, description: 'Mise remboursée' },
    session
  );
}

export async function settleDuelWallets({ winnerId, loserId, stake, winnerAmount, commissionAmount, duelId }, session) {
  const winnerWallet = await ensureWallet(winnerId, session);
  const loserWallet = await ensureWallet(loserId, session);

  winnerWallet.balanceLocked = Math.max(winnerWallet.balanceLocked - stake, 0);
  loserWallet.balanceLocked = Math.max(loserWallet.balanceLocked - stake, 0);
  winnerWallet.balanceAvailable += winnerAmount;
  winnerWallet.balanceTotal += winnerAmount - stake;
  loserWallet.balanceTotal -= stake;
  winnerWallet.totalWon += winnerAmount;
  loserWallet.totalLost += stake;

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

  // Log audit for duel settlement
  await logCriticalAction('wallet:duel_settlement', winnerId, { 
    duelId, 
    winnerAmount, 
    commissionAmount,
    winTransactionId: winTransaction._id 
  });
}

export async function adjustBalance(userId, amount, description, session) {
  const wallet = await ensureWallet(userId, session);
  wallet.balanceAvailable += amount;
  wallet.balanceTotal += amount;
  if (wallet.balanceAvailable < 0 || wallet.balanceTotal < 0) throw new AppError('L\'ajustement créerait un solde négatif', 422);
  await wallet.save({ session });

  await createTransaction({ user: userId, type: 'admin_adjustment', amount, description }, session);
  return wallet;
}
