import mongoose from 'mongoose';

const commissionSettingSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    minAmount: { type: Number, required: true },
    maxAmount: { type: Number, default: null },
    rate: { type: Number, required: true },
    type: { type: String, enum: ['duel', 'tournament'], default: 'duel' },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export const CommissionSetting = mongoose.model('CommissionSetting', commissionSettingSchema);
