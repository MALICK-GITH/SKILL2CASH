import mongoose from 'mongoose';

const publicInvitationSchema = new mongoose.Schema(
  {
    host: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    gameProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'GameProfile', required: true },
    mode: { type: String, default: '1v1' },
    scheduledTime: { type: Date, default: null },
    notes: { type: String, default: '' },
    status: {
      type: String,
      enum: ['open', 'accepted', 'closed', 'expired'],
      default: 'open',
      index: true
    },
    expiresAt: { type: Date, required: true, index: true },
    acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    acceptedAt: { type: Date, default: null },
    challenge: { type: mongoose.Schema.Types.ObjectId, ref: 'Challenge', default: null }
  },
  { timestamps: true }
);

publicInvitationSchema.index({ host: 1, status: 1 });
publicInvitationSchema.index({ room: 1, status: 1 });
publicInvitationSchema.index({ expiresAt: 1, status: 1 });

export const PublicInvitation = mongoose.model('PublicInvitation', publicInvitationSchema);
