import mongoose from 'mongoose';

const challengeSchema = new mongoose.Schema(
  {
    challenger: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    challenged: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true, min: 1 },
    matchType: { type: String, default: 'eFootball 1v1' },
    rules: { type: String, default: 'Standard 10 min, no cheats, screenshot required.' },
    message: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined', 'expired', 'cancelled', 'counter_offer'],
      default: 'pending'
    },
    counterAmount: { type: Number, default: null },
    expiresAt: { type: Date, required: true }
  },
  { timestamps: true }
);

challengeSchema.index({ challenger: 1, challenged: 1, status: 1 });

export const Challenge = mongoose.model('Challenge', challengeSchema);
