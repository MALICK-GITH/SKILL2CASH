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
    autoVerificationStatus: { type: String, enum: ['pending', 'matched', 'needs_review', 'failed'], default: 'pending', index: true },
    autoVerificationReason: { type: String, default: '' },
    ocrText: { type: String, default: '' },
    ocrConfidence: { type: Number, default: 0 },
    ocrDetectedSender: { type: String, default: '' },
    ocrDetectedAmount: { type: String, default: '' },
    ocrDetectedReference: { type: String, default: '' },
    ocrDetectedStatus: { type: String, default: '' },
    ocrAmountCandidates: [{ type: String }],
    screenshotFingerprint: { type: String, default: '', index: true },
    fraudScore: { type: Number, default: 0, index: true },
    fraudFlags: [{ type: String }],
    adminNote: { type: String, default: '' },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true }
);

depositSchema.index({ user: 1, status: 1, createdAt: -1 });

export const Deposit = mongoose.model('Deposit', depositSchema);
