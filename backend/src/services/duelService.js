import mongoose from 'mongoose';
import { Challenge } from '../models/Challenge.js';
import { Duel } from '../models/Duel.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { calculateCommission, getCommissionRate } from './commissionService.js';
import { notifyRoom, notifyUser } from './notificationService.js';
import { analyzeMatchScreenshot, shouldAutoApproveWithOcr } from './ocrService.js';
import { badgeForUser, rankForUser } from './rankService.js';
import { lockStake, refundStake, settleDuelWallets } from './walletService.js';
import { logCriticalAction, logError } from './auditLogService.js';

export async function acceptChallenge(challengeId, userId) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const challenge = await Challenge.findById(challengeId).session(session);
      if (!challenge) throw new AppError('Défi non trouvé', 404);
      if (String(challenge.challenged) !== String(userId)) throw new AppError('Seul le joueur défié peut accepter', 403);
      if (challenge.status !== 'pending' && challenge.status !== 'counter_offer') throw new AppError('Le défi n\'est pas ouvert', 422);
      if (challenge.expiresAt < new Date()) {
        challenge.status = 'expired';
        await challenge.save({ session });
        throw new AppError('Défi expiré', 422);
      }

      await lockStake(challenge.challenger, challenge.amount, challenge._id, session);
      await lockStake(challenge.challenged, challenge.amount, challenge._id, session);

      const potTotal = challenge.amount * 2;
      const commissionRate = await getCommissionRate(challenge.amount);
      const { commissionAmount, winnerAmount } = calculateCommission(potTotal, commissionRate);
      const roomId = `s2c-${challenge._id.toString().slice(-8)}-${Date.now().toString(36)}`;

      const duel = await Duel.create(
        [
          {
            challenge: challenge._id,
            player1: challenge.challenger,
            player2: challenge.challenged,
            amount: challenge.amount,
            potTotal,
            commissionRate,
            commissionAmount,
            winnerAmount,
            rules: challenge.rules,
            matchType: challenge.matchType,
            roomId
          }
        ],
        { session }
      ).then((docs) => docs[0]);

      challenge.status = 'accepted';
      await challenge.save({ session });
      
      await logCriticalAction('duel:challenge_accepted', userId, { 
        challengeId: challenge._id, 
        duelId: duel._id, 
        amount: challenge.amount 
      });
      
      notifyUser(challenge.challenger, 'challenge:accepted', { challengeId: challenge._id, duelId: duel._id });
      notifyUser(challenge.challenged, 'duel:active', { duelId: duel._id, roomId });
      return duel;
    });
  } catch (error) {
    await logError('duel:challenge_accepted', userId, error.message, { challengeId });
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function cancelDuel(duelId, reason = 'Duel cancelled by admin') {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const duel = await Duel.findById(duelId).session(session);
      if (!duel) throw new AppError('Duel non trouvé', 404);
      if (duel.status === 'finished' || duel.status === 'cancelled') throw new AppError('Duel déjà terminé', 422);

      await refundStake(duel.player1, duel.amount, duel._id, session);
      await refundStake(duel.player2, duel.amount, duel._id, session);
      duel.status = 'cancelled';
      duel.disputeReason = reason;
      duel.finishedAt = new Date();
      await duel.save({ session });
      notifyRoom(duel.roomId, 'duel:cancelled', { duelId: duel._id, reason });
      return duel;
    });
  } finally {
    await session.endSession();
  }
}

export async function submitResult(duelId, userId, result) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const duel = await Duel.findById(duelId).session(session);
      if (!duel) throw new AppError('Duel not found', 404);
      if (!['active', 'waiting_result', 'dispute'].includes(duel.status)) throw new AppError('Duel fermé', 422);

      const isPlayer1 = String(duel.player1) === String(userId);
      const isPlayer2 = String(duel.player2) === String(userId);
      if (!isPlayer1 && !isPlayer2) throw new AppError('Vous ne faites pas partie de ce duel', 403);

      const payload = {
        score: result.score,
        declaredWinner: result.declaredWinner,
        screenshot: result.screenshot,
        comment: result.comment || ''
      };

      const [player1, player2] = await Promise.all([
        User.findById(duel.player1).select('username').session(session),
        User.findById(duel.player2).select('username').session(session)
      ]);
      const ocr = await analyzeMatchScreenshot(payload.screenshot, [player1, player2]);

      if (isPlayer1) duel.resultPlayer1 = payload;
      if (isPlayer2) duel.resultPlayer2 = payload;
      if (isPlayer1) {
        duel.ocrTextPlayer1 = ocr.text;
        duel.ocrScorePlayer1 = ocr.score;
        duel.ocrScoreCandidatesPlayer1 = ocr.scoreCandidates || [];
        duel.ocrPlayersDetectedPlayer1 = ocr.playersDetected;
        duel.ocrConfidencePlayer1 = ocr.confidence;
      }
      if (isPlayer2) {
        duel.ocrTextPlayer2 = ocr.text;
        duel.ocrScorePlayer2 = ocr.score;
        duel.ocrScoreCandidatesPlayer2 = ocr.scoreCandidates || [];
        duel.ocrPlayersDetectedPlayer2 = ocr.playersDetected;
        duel.ocrConfidencePlayer2 = ocr.confidence;
      }
      duel.status = 'waiting_result';
      duel.autoValidationStatus = ocr.status === 'failed' ? 'failed' : 'pending';
      duel.autoValidationReason = ocr.error || '';

      if (duel.resultPlayer1 && duel.resultPlayer2) {
        const validation = shouldAutoApproveWithOcr({ duel, player1, player2 });
        if (validation.approved) {
          duel.autoValidationStatus = 'auto_approved';
          duel.autoValidationReason = validation.reason;
          await duel.save({ session });
          return finishDuel(duel._id, duel.resultPlayer1.declaredWinner, session);
        }

        duel.status = 'dispute';
        const anyOcrFailed = [duel.ocrTextPlayer1, duel.ocrTextPlayer2].some((text) => !text) &&
          [duel.ocrConfidencePlayer1, duel.ocrConfidencePlayer2].some((confidence) => confidence === 0);
        duel.autoValidationStatus = ocr.status === 'failed' || anyOcrFailed ? 'failed' : 'manual_review';
        duel.autoValidationReason = validation.reason;
        duel.disputeReason = validation.reason;
      }

      await duel.save({ session });
      notifyRoom(duel.roomId, 'duel:result_submitted', { duelId: duel._id, status: duel.status });
      if (duel.status === 'dispute') notifyRoom(duel.roomId, 'duel:dispute_opened', { duelId: duel._id });
      return duel;
    });
  } finally {
    await session.endSession();
  }
}

export async function finishDuel(duelId, winnerId, session = null) {
  const useSession = session || (await mongoose.startSession());
  const shouldEndSession = !session;

  try {
    const execute = async () => {
      const duel = await Duel.findById(duelId).session(useSession);
      if (!duel) throw new AppError('Duel non trouvé', 404);
      if (duel.status === 'finished') throw new AppError('Duel déjà terminé', 422);
      if (duel.status === 'cancelled') throw new AppError('Duel déjà annulé', 422);

      const winner = String(duel.player1) === String(winnerId) ? duel.player1 : String(duel.player2) === String(winnerId) ? duel.player2 : null;
      if (!winner) throw new AppError('Le gagnant doit être l\'un des joueurs du duel', 422);

      const loser = String(winner) === String(duel.player1) ? duel.player2 : duel.player1;
      await settleDuelWallets({
        winnerId: winner,
        loserId: loser,
        stake: duel.amount,
        winnerAmount: duel.winnerAmount,
        commissionAmount: duel.commissionAmount,
        duelId: duel._id
      }, useSession);

      const winnerUser = await User.findById(winner).session(useSession);
      const loserUser = await User.findById(loser).session(useSession);
      
      // Update winner stats
      winnerUser.wins += 1;
      winnerUser.totalEarnings += duel.winnerAmount;
      winnerUser.currentStreak += 1;
      if (winnerUser.currentStreak > winnerUser.maxStreak) {
        winnerUser.maxStreak = winnerUser.currentStreak;
      }
      winnerUser.rank = rankForUser(winnerUser);
      winnerUser.badge = badgeForUser(winnerUser);
      
      // Update loser stats
      loserUser.losses += 1;
      loserUser.currentStreak = 0;
      loserUser.rank = rankForUser(loserUser);
      loserUser.badge = badgeForUser(loserUser);
      
      await winnerUser.save({ session: useSession });
      await loserUser.save({ session: useSession });

      duel.winner = winner;
      duel.loser = loser;
      duel.status = 'finished';
      duel.finishedAt = new Date();
      await duel.save({ session: useSession });
      notifyRoom(duel.roomId, 'duel:finished', { duelId: duel._id, winnerId: winner });
      return duel;
    };

    if (shouldEndSession) {
      return await useSession.withTransaction(execute);
    }

    return await execute();
  } finally {
    if (shouldEndSession) await useSession.endSession();
  }
}
