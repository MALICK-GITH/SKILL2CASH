import mongoose from 'mongoose';

const resultSchema = new mongoose.Schema(
  {
    score: { type: String, required: true },
    myScore: { type: Number, default: null },
    opponentScore: { type: Number, default: null },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    submittedFor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    declaredWinner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    screenshot: { type: String, required: true },
    imageHash: { type: String, default: '' },
    imageFingerprint: { type: String, default: '' },
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
      enum: [
        'active',
        'waiting_player1_proof',
        'waiting_player2_proof',
        'analyzing',
        'finished',
        'dispute',
        'waiting_result',
        'under_review',
        'cancelled'
      ],
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
    manualReviewRequestedAt: { type: Date, default: null },
    manualReviewDueAt: { type: Date, default: null },
    isDraw: { type: Boolean, default: false },
    winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    loser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    disputeReason: { type: String, default: '' },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

duelSchema.pre('validate', function enforceDrawConsistency(next) {
  // Business rule: enforce winner/loser consistency when duel is finalized.
  if (this.status !== 'finished') return next();

  if (this.isDraw) {
    if (this.winner != null || this.loser != null) {
      const err = new mongoose.Error.ValidationError(this);
      err.addError('isDraw', new mongoose.Error.ValidatorError({
        path: 'isDraw',
        message: 'Un duel nul terminé doit avoir winner et loser à null.'
      }));
      return next(err);
    }
    return next();
  }

  if (this.winner == null || this.loser == null) {
    const err = new mongoose.Error.ValidationError(this);
    err.addError('winner', new mongoose.Error.ValidatorError({
      path: 'winner',
      message: 'Un duel terminé non nul doit définir winner et loser.'
    }));
    return next(err);
  }
  return next();
});

export const Duel = mongoose.model('Duel', duelSchema);
