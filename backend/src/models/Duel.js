import mongoose from 'mongoose';

const resultSchema = new mongoose.Schema(
  {
    score: { type: String, required: true },
    declaredWinner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    screenshot: { type: String, required: true },
    comment: { type: String, default: '' },
    submittedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const duelSchema = new mongoose.Schema(
  {
    challenge: { type: mongoose.Schema.Types.ObjectId, ref: 'Challenge' },
    player1: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    player2: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    potTotal: { type: Number, required: true },
    commissionRate: { type: Number, required: true },
    commissionAmount: { type: Number, required: true },
    winnerAmount: { type: Number, required: true },
    status: {
      type: String,
      enum: ['active', 'waiting_result', 'under_review', 'dispute', 'finished', 'cancelled'],
      default: 'active'
    },
    rules: { type: String, default: '' },
    matchType: { type: String, default: 'eFootball 1v1' },
    roomId: { type: String, required: true, unique: true },
    resultPlayer1: { type: resultSchema, default: null },
    resultPlayer2: { type: resultSchema, default: null },
    ocrTextPlayer1: { type: String, default: '' },
    ocrTextPlayer2: { type: String, default: '' },
    ocrScorePlayer1: { type: String, default: '' },
    ocrScorePlayer2: { type: String, default: '' },
    ocrScoreCandidatesPlayer1: [{ type: String }],
    ocrScoreCandidatesPlayer2: [{ type: String }],
    ocrPlayersDetectedPlayer1: [{ type: String }],
    ocrPlayersDetectedPlayer2: [{ type: String }],
    ocrConfidencePlayer1: { type: Number, default: 0 },
    ocrConfidencePlayer2: { type: Number, default: 0 },
    autoValidationStatus: {
      type: String,
      enum: ['pending', 'auto_approved', 'manual_review', 'failed'],
      default: 'pending'
    },
    autoValidationReason: { type: String, default: '' },
    winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    loser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    disputeReason: { type: String, default: '' },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

export const Duel = mongoose.model('Duel', duelSchema);
