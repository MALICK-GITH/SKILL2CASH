import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** Type canonique (challenge_received, deposit_pending, …). */
    type: { type: String, required: true, index: true },
    /** Événement domaine d’origine (ex. challenge:new), pour idempotence / recovery. */
    domainEvent: { type: String, default: null, index: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    link: { type: String, default: '' },
    metadata: { type: Object, default: {} },
    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
    priority: {
      type: String,
      enum: ['low', 'normal', 'medium', 'high', 'urgent'],
      default: 'medium',
      index: true
    },
    archivedAt: { type: Date, default: null, index: true }
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ user: 1, archivedAt: 1, createdAt: -1 });

export const Notification = mongoose.model('Notification', notificationSchema);
