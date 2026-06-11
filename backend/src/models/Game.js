import mongoose from 'mongoose';

const gameSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    description: { type: String, default: '' },
    coverImage: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    developer: { type: String, default: '' },
    publisher: { type: String, default: '' },
    releaseYear: { type: Number, default: null }
  },
  { timestamps: true }
);

gameSchema.index({ isActive: 1 });

export const Game = mongoose.model('Game', gameSchema);
