import mongoose from 'mongoose';

const arbitrationSchema = new mongoose.Schema(
  {
    duel: { type: mongoose.Schema.Types.ObjectId, ref: 'Duel', required: true, unique: true },
    challenger: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    opponent: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    arbitrator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    status: {
      type: String,
      enum: ['pending', 'in_review', 'resolved', 'escalated'],
      default: 'pending',
      index: true
    },
    challengerEvidence: {
      screenshots: [{ type: String }],
      descriptions: [{ type: String }],
      submittedAt: { type: Date, default: null }
    },
    opponentEvidence: {
      screenshots: [{ type: String }],
      descriptions: [{ type: String }],
      submittedAt: { type: Date, default: null }
    },
    reviewNotes: { type: String, default: '' },
    decision: {
      type: String,
      enum: ['challenger_win', 'opponent_win', 'draw', 'cancelled', 'rematch'],
      default: null
    },
    decisionReason: { type: String, default: '' },
    resolvedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

arbitrationSchema.index({ arbitrator: 1 });

export const Arbitration = mongoose.model('Arbitration', arbitrationSchema);
