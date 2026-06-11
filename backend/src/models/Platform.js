import mongoose from 'mongoose';

const platformSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    icon: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    manufacturer: { type: String, default: '' }
  },
  { timestamps: true }
);

platformSchema.index({ isActive: 1 });

export const Platform = mongoose.model('Platform', platformSchema);
