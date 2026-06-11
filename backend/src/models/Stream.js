import mongoose from 'mongoose';

const streamSchema = new mongoose.Schema(
  {
    duel: { type: mongoose.Schema.Types.ObjectId, ref: 'Duel', required: true, unique: true },
    channelName: { type: String, required: true, trim: true },
    streamUrl: { type: String, required: true },
    streamKey: { type: String, required: true },
    status: {
      type: String,
      enum: ['scheduled', 'live', 'ended', 'cancelled'],
      default: 'scheduled',
      index: true
    },
    scheduledStartTime: { type: Date, required: true },
    actualStartTime: { type: Date, default: null },
    endTime: { type: Date, default: null },
    peakViewers: { type: Number, default: 0 },
    vodUrl: { type: String, default: '' },
    notes: { type: String, default: '' }
  },
  { timestamps: true }
);

streamSchema.index({ scheduledStartTime: 1 });

export const Stream = mongoose.model('Stream', streamSchema);
