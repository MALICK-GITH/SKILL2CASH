import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ipAddress: { type: String, required: true },
    userAgent: { type: String, required: true },
    deviceType: { type: String, default: '' },
    browser: { type: String, default: '' },
    os: { type: String, default: '' },
    location: { type: String, default: '' },
    telegramWebApp: { type: Boolean, default: false },
    telegramId: { type: String, default: null },
    sessionKey: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: true },
    lastActivity: { type: Date, default: Date.now },
    isRevoked: { type: Boolean, default: false, index: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: '' }
  },
  { timestamps: true }
);

sessionSchema.index({ user: 1, isRevoked: 1 });
sessionSchema.index({ expiresAt: 1, isRevoked: 1 });

export const Session = mongoose.model('Session', sessionSchema);
