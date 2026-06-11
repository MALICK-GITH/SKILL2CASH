import mongoose from 'mongoose';
import { Challenge } from '../models/Challenge.js';
import { AdminLog } from '../models/AdminLog.js';
import { AppError } from '../utils/AppError.js';
import { notifyUser } from './notificationService.js';
import { refundStake } from './walletService.js';

const OPEN_CHALLENGE_STATUSES = ['pending', 'counter_offer'];

export async function cancelOpenChallenges(adminId, { note = 'Nettoyage admin via assistant IA' } = {}) {
  if (!adminId) {
    throw new AppError('Action admin requise', 403);
  }

  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(async () => {
      const challenges = await Challenge.find({ status: { $in: OPEN_CHALLENGE_STATUSES } })
        .populate('challenger challenged', 'username efootballUsername')
        .session(session);

      if (!challenges.length) {
        return { count: 0, challengeIds: [] };
      }

      const now = new Date();
      for (const challenge of challenges) {
        if (Number(challenge.reservedAmount || 0) > 0) {
          await refundStake(challenge.challenger, challenge.reservedAmount, challenge._id, session);
        }
        challenge.status = 'cancelled';
        challenge.expiresAt = now;
        challenge.message = challenge.message || note;
        await challenge.save({ session });

        await AdminLog.create([{
          admin: adminId,
          action: 'challenge_cancelled',
          targetType: 'Challenge',
          targetId: challenge._id,
          note,
          metadata: {
            challenger: challenge.challenger?._id || challenge.challenger,
            challenged: challenge.challenged?._id || challenge.challenged,
            amount: challenge.amount,
            roomId: challenge.roomId
          }
        }], { session });
      }

      return {
        count: challenges.length,
        challengeIds: challenges.map((challenge) => challenge._id),
        challenges: challenges.map((challenge) => ({
          id: challenge._id,
          challenger: challenge.challenger,
          challenged: challenge.challenged,
          amount: challenge.amount,
          roomId: challenge.roomId
        }))
      };
    });

    if (!result.count) return result;

    for (const challenge of result.challenges) {
      await Promise.allSettled([
        notifyUser(challenge.challenger?._id || challenge.challenger, 'challenge:cancelled', {
          challengeId: challenge.id,
          reason: 'Nettoyage admin IA'
        }),
        notifyUser(challenge.challenged?._id || challenge.challenged, 'challenge:cancelled', {
          challengeId: challenge.id,
          reason: 'Nettoyage admin IA'
        })
      ]);
    }

    return result;
  } finally {
    await session.endSession();
  }
}
