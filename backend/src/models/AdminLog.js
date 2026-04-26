import mongoose from 'mongoose';

const adminLogSchema = new mongoose.Schema(
  {
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true },
    targetType: { type: String, required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
    note: { type: String, default: '' },
    metadata: { type: Object, default: {} }
  },
  { timestamps: true }
);

export const AdminLog = mongoose.model('AdminLog', adminLogSchema);
