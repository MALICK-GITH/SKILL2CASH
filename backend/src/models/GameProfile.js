import mongoose from 'mongoose';

const gameProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    game: { type: mongoose.Schema.Types.ObjectId, ref: 'Game', required: true, index: true },
    platform: { type: mongoose.Schema.Types.ObjectId, ref: 'Platform', required: true, index: true },
    gamertag: { type: String, required: true, trim: true },
    rank: { type: String, default: '' },
    level: { type: Number, default: 1 },
    kda: { type: String, default: '0.0' },
    winRate: { type: Number, default: 0 },
    totalMatches: { type: Number, default: 0 },
    isPrimary: { type: Boolean, default: false },
    isVerified: { type: Boolean, default: false },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

gameProfileSchema.index({ user: 1, game: 1, platform: 1 }, { unique: true });
gameProfileSchema.index({ user: 1, isPrimary: 1 });
gameProfileSchema.index({ gamertag: 1 });

export const GameProfile = mongoose.model('GameProfile', gameProfileSchema);
