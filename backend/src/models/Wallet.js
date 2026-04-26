import mongoose from 'mongoose';

const walletSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    balanceTotal: { type: Number, default: 0 },
    balanceAvailable: { type: Number, default: 0 },
    balanceLocked: { type: Number, default: 0 },
    totalDeposited: { type: Number, default: 0 },
    totalWithdrawn: { type: Number, default: 0 },
    totalWon: { type: Number, default: 0 },
    totalLost: { type: Number, default: 0 },
    deletedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

export const Wallet = mongoose.model('Wallet', walletSchema);
