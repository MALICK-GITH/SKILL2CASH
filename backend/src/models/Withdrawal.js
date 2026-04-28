import mongoose from 'mongoose';

const withdrawalSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true, min: 1 },
    feeRate: { type: Number, default: 0.03 },
    feeAmount: { type: Number, required: true },
    netAmount: { type: Number, required: true },
    method: { type: String, enum: ['wave', 'mtn', 'Mobile Money', 'Crypto', 'Bank', 'Manual'], required: true },
    phoneOrWallet: { type: String, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'paid'], default: 'pending' },
    adminNote: { type: String, default: '' }
  },
  { timestamps: true }
);

export const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);
