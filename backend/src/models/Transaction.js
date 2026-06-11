import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    type: {
      type: String,
      enum: ['deposit', 'withdraw', 'challenge_lock', 'challenge_refund', 'duel_win', 'duel_loss', 'commission', 'admin_adjustment'],
      required: true
    },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'success', 'failed', 'cancelled'], default: 'success' },
    referenceId: { type: mongoose.Schema.Types.ObjectId },
    description: { type: String, default: '' },
    metadata: { type: Object, default: {} }
  },
  { timestamps: true }
);

export const Transaction = mongoose.model('Transaction', transactionSchema);
