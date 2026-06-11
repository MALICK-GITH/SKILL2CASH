import mongoose from 'mongoose';

const adminLogSchema = new mongoose.Schema(
  {
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    actorRole: { type: String, default: 'admin' },
    action: { type: String, required: true },
    targetType: { type: String, required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
    note: { type: String, default: '' },
    metadata: { type: Object, default: {} },
    beforeState: { type: Object, default: null },
    afterState: { type: Object, default: null },
    ipAddress: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    status: { type: String, enum: ['success', 'failed', 'pending'], default: 'success' }
  },
  { timestamps: true }
);

adminLogSchema.index({ action: 1, createdAt: -1 });
adminLogSchema.index({ admin: 1, createdAt: -1 });
adminLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

export const AdminLog = mongoose.model('AdminLog', adminLogSchema);
