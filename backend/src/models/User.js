import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { buildTrustProfile, calculateTrustScore, trustTierForScore } from '../services/trustService.js';

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 24 },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    efootballUsername: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 24 },
    usernameLocked: { type: Boolean, default: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true, unique: true },
    phoneValidated: { type: Boolean, default: false },
    telegramId: { type: String, default: null, sparse: true },
    telegramData: {
      id: { type: String, default: null },
      firstName: { type: String, default: null },
      lastName: { type: String, default: null },
      username: { type: String, default: null },
      languageCode: { type: String, default: null }
    },
    telegramLinkCode: { type: String, default: null, sparse: true, index: true },
    passwordHash: { type: String, required: true },
    avatar: { type: String, default: '' },
    country: { type: String, default: 'Global' },
    level: { type: String, enum: ['Beginner', 'Intermediate', 'Pro', 'Elite'], default: 'Intermediate' },
    status: { type: String, enum: ['online', 'offline', 'busy', 'available'], default: 'available' },
    role: { type: String, enum: ['player', 'admin'], default: 'player' },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    currentStreak: { type: Number, default: 0 },
    maxStreak: { type: Number, default: 0 },
    totalEarnings: { type: Number, default: 0 },
    reputation: { type: Number, default: 100 },
    reportsCount: { type: Number, default: 0 },
    badge: { type: String, default: 'New Blood' },
    rank: { type: String, enum: ['Bronze', 'Silver', 'Gold', 'Elite', 'Legend'], default: 'Bronze' },
    minStake: { type: Number, default: 500 },
    maxStake: { type: Number, default: 25000 },
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    isBanned: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    notificationPreferences: {
      email: {
        challenges: { type: Boolean, default: true },
        matches: { type: Boolean, default: true },
        results: { type: Boolean, default: true },
        wallet: { type: Boolean, default: true },
        promotions: { type: Boolean, default: false }
      },
      push: {
        challenges: { type: Boolean, default: true },
        matches: { type: Boolean, default: true },
        results: { type: Boolean, default: true },
        wallet: { type: Boolean, default: true }
      },
      telegram: {
        challenges: { type: Boolean, default: true },
        matches: { type: Boolean, default: true },
        results: { type: Boolean, default: true },
        wallet: { type: Boolean, default: true }
      }
    }
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

userSchema.virtual('winRate').get(function getWinRate() {
  const total = this.wins + this.losses;
  return total === 0 ? 0 : Math.round((this.wins / total) * 100);
});

userSchema.virtual('trustScore').get(function getTrustScore() {
  return calculateTrustScore(this);
});

userSchema.virtual('trustTier').get(function getTrustTier() {
  return trustTierForScore(calculateTrustScore(this)).label;
});

userSchema.virtual('trustProfile').get(function getTrustProfile() {
  return buildTrustProfile(this);
});

userSchema.methods.comparePassword = function comparePassword(password) {
  return bcrypt.compare(password, this.passwordHash);
};

userSchema.statics.hashPassword = function hashPassword(password) {
  return bcrypt.hash(password, 12);
};

export const User = mongoose.model('User', userSchema);
