import mongoose from 'mongoose';

const roomSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    game: { type: mongoose.Schema.Types.ObjectId, ref: 'Game', required: true, index: true },
    platform: { type: mongoose.Schema.Types.ObjectId, ref: 'Platform', required: true, index: true },
    betAmount: { type: Number, required: true, min: 0 },
    winMultiplier: { type: Number, default: 1.8 },
    platformFee: { type: Number, default: 0.1 },
    minRank: { type: String, default: '' },
    maxRank: { type: String, default: '' },
    minLevel: { type: Number, default: 1 },
    isActive: { type: Boolean, default: true, index: true },
    isFeatured: { type: Boolean, default: false, index: true },
    description: { type: String, default: '' },
    rules: { type: String, default: '' }
  },
  { timestamps: true }
);

roomSchema.index({ game: 1, platform: 1, isActive: 1 });
roomSchema.index({ betAmount: 1 });
roomSchema.index({ isFeatured: 1, isActive: 1 });

export const Room = mongoose.model('Room', roomSchema);
