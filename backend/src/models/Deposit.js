import mongoose from 'mongoose';

const depositSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    method: { type: String, enum: ['wave', 'mtn'], required: true, index: true },
    amount: { type: Number, required: true, min: 1 },
    senderName: { type: String, required: true, trim: true },
    senderPhone: { type: String, required: true, trim: true },
    transactionReference: { type: String, trim: true, default: '' },
    screenshotUrl: { type: String, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    adminNote: { type: String, default: '' },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true }
);

depositSchema.index({ user: 1, status: 1, createdAt: -1 });

export const Deposit = mongoose.model('Deposit', depositSchema);
