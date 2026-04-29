import { Arbitration } from '../models/Arbitration.js';
import { Duel } from '../models/Duel.js';
import { User } from '../models/User.js';
import mongoose from 'mongoose';
import { unlockFunds, creditWallet, debitWallet } from './walletService.js';
import { AppError } from '../utils/AppError.js';

export const arbitrationService = {
  async getAllArbitrations(filters = {}) {
    const { status, arbitrator } = filters;
    const query = {};
    if (status) query.status = status;
    if (arbitrator) query.arbitrator = arbitrator;
    return await Arbitration.find(query)
      .populate('duel')
      .populate('challenger', 'username firstName lastName avatar')
      .populate('opponent', 'username firstName lastName avatar')
      .populate('arbitrator', 'username firstName lastName avatar')
      .sort({ createdAt: -1 });
  },

  async getArbitrationById(id) {
    const arbitration = await Arbitration.findById(id)
      .populate('duel')
      .populate('challenger', 'username firstName lastName avatar')
      .populate('opponent', 'username firstName lastName avatar')
      .populate('arbitrator', 'username firstName lastName avatar');
    if (!arbitration) {
      throw new AppError('Arbitration not found', 404);
    }
    return arbitration;
  },

  async getArbitrationByDuel(duelId) {
    const arbitration = await Arbitration.findOne({ duel: duelId })
      .populate('duel')
      .populate('challenger', 'username firstName lastName avatar')
      .populate('opponent', 'username firstName lastName avatar')
      .populate('arbitrator', 'username firstName lastName avatar');
    if (!arbitration) {
      throw new AppError('Arbitration not found for this duel', 404);
    }
    return arbitration;
  },

  async createArbitration(duelId, disputeReason) {
    const duel = await Duel.findById(duelId);
    if (!duel) {
      throw new AppError('Duel not found', 404);
    }

    const existingArbitration = await Arbitration.findOne({ duel: duelId });
    if (existingArbitration) {
      throw new AppError('Arbitration already exists for this duel', 400);
    }

    const arbitration = await Arbitration.create({
      duel: duelId,
      challenger: duel.player1,
      opponent: duel.player2,
      status: 'pending'
    });

    await Duel.findByIdAndUpdate(duelId, { status: 'dispute', disputeReason });

    return await this.getArbitrationById(arbitration._id);
  },

  async assignArbitrator(id, arbitratorId) {
    const arbitration = await Arbitration.findByIdAndUpdate(
      id,
      { arbitrator: arbitratorId, status: 'in_review' },
      { new: true }
    );
    if (!arbitration) {
      throw new AppError('Arbitration not found', 404);
    }
    return await this.getArbitrationById(id);
  },

  async submitChallengerEvidence(id, evidence) {
    const arbitration = await Arbitration.findByIdAndUpdate(
      id,
      { 
        'challengerEvidence.screenshots': evidence.screenshots || [],
        'challengerEvidence.descriptions': evidence.descriptions || [],
        'challengerEvidence.submittedAt': new Date()
      },
      { new: true }
    );
    if (!arbitration) {
      throw new AppError('Arbitration not found', 404);
    }
    return await this.getArbitrationById(id);
  },

  async submitOpponentEvidence(id, evidence) {
    const arbitration = await Arbitration.findByIdAndUpdate(
      id,
      { 
        'opponentEvidence.screenshots': evidence.screenshots || [],
        'opponentEvidence.descriptions': evidence.descriptions || [],
        'opponentEvidence.submittedAt': new Date()
      },
      { new: true }
    );
    if (!arbitration) {
      throw new AppError('Arbitration not found', 404);
    }
    return await this.getArbitrationById(id);
  },

  async resolveArbitration(id, decision, decisionReason, arbitratorId) {
    const arbitration = await this.getArbitrationById(id);
    const duel = await Duel.findById(arbitration.duel._id);

    if (!duel) {
      throw new AppError('Duel not found', 404);
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      if (decision === 'challenger_win' || decision === 'opponent_win') {
        const winnerId = decision === 'challenger_win' ? duel.player1 : duel.player2;
        const loserId = decision === 'challenger_win' ? duel.player2 : duel.player1;

        await unlockFunds(arbitration.challenger._id, duel.amount, session);
        await unlockFunds(arbitration.opponent._id, duel.amount, session);

        const winAmount = duel.winnerAmount;
        await creditWallet(winnerId, winAmount, 'duel_win', duel._id, 'Arbitration win', session);
        await debitWallet(loserId, duel.amount, 'duel_loss', duel._id, 'Arbitration loss', session);

        await User.findByIdAndUpdate(winnerId, { $inc: { wins: 1 } }, { session });
        await User.findByIdAndUpdate(loserId, { $inc: { losses: 1 } }, { session });

        await Duel.findByIdAndUpdate(duel._id, { 
          winner: winnerId, 
          loser: loserId,
          status: 'finished',
          finishedAt: new Date()
        }, { session });

      } else if (decision === 'draw' || decision === 'cancelled' || decision === 'rematch') {
        await unlockFunds(arbitration.challenger._id, duel.amount, session);
        await unlockFunds(arbitration.opponent._id, duel.amount, session);

        await creditWallet(arbitration.challenger._id, duel.amount, 'challenge_refund', duel._id, 'Arbitration refund', session);
        await creditWallet(arbitration.opponent._id, duel.amount, 'challenge_refund', duel._id, 'Arbitration refund', session);

        await Duel.findByIdAndUpdate(duel._id, { 
          status: decision === 'rematch' ? 'cancelled' : 'finished',
          finishedAt: new Date()
        }, { session });
      }

      const updatedArbitration = await Arbitration.findByIdAndUpdate(
        id,
        { 
          decision, 
          decisionReason, 
          status: 'resolved',
          resolvedAt: new Date()
        },
        { new: true, session }
      );

      await session.commitTransaction();
      session.endSession();

      return await this.getArbitrationById(id);
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  },

  async escalateArbitration(id) {
    const arbitration = await Arbitration.findByIdAndUpdate(
      id,
      { status: 'escalated' },
      { new: true }
    );
    if (!arbitration) {
      throw new AppError('Arbitration not found', 404);
    }
    return await this.getArbitrationById(id);
  }
};
