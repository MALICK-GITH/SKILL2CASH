import mongoose from 'mongoose';

const challengeSchema = new mongoose.Schema(
  {
    challenger: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    challenged: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    challengerGameProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'GameProfile', default: null },
    challengedGameProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'GameProfile', default: null },
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', default: null },
    amount: { type: Number, required: true, min: 1 },
    reservedAmount: { type: Number, default: 0, min: 0 },
    fundsReservedAt: { type: Date, default: null },
    matchType: { type: String, default: '1v1' },
    rules: { type: String, default: 'Standard match, no cheats, screenshot required.' },
    message: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined', 'expired', 'cancelled', 'counter_offer', 'in_progress', 'completed', 'disputed'],
      default: 'pending'
    },
    counterAmount: { type: Number, default: null },
    scheduledTime: { type: Date, default: null },
    matchCode: { type: String, unique: true, sparse: true },
    roomId: { type: String, required: true, unique: true },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 30 * 60 * 1000)
    },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

challengeSchema.index({ challenger: 1, challenged: 1, status: 1 });

export const Challenge = mongoose.model('Challenge', challengeSchema);
