import mongoose from 'mongoose';

const usernameChangeRequestSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    currentUsername: { type: String, required: true },
    requestedUsername: { type: String, required: true },
    reason: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    adminNote: { type: String, default: '' },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true }
);

usernameChangeRequestSchema.index({ user: 1, status: 1 });

export const UsernameChangeRequest = mongoose.model('UsernameChangeRequest', usernameChangeRequestSchema);
