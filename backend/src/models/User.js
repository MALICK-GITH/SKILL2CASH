import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 24 },
    efootballUsername: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 24 },
    usernameLocked: { type: Boolean, default: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
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
    deletedAt: { type: Date, default: null }
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

userSchema.virtual('winRate').get(function getWinRate() {
  const total = this.wins + this.losses;
  return total === 0 ? 0 : Math.round((this.wins / total) * 100);
});

userSchema.methods.comparePassword = function comparePassword(password) {
  return bcrypt.compare(password, this.passwordHash);
};

userSchema.statics.hashPassword = function hashPassword(password) {
  return bcrypt.hash(password, 12);
};

export const User = mongoose.model('User', userSchema);
