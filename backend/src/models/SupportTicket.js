import mongoose from 'mongoose';

const supportTicketSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    category: {
      type: String,
      enum: ['dispute', 'deposit', 'withdrawal', 'username_change', 'technical', 'other'],
      required: true,
      index: true
    },
    subject: { type: String, required: true, trim: true, maxlength: 160 },
    message: { type: String, required: true, trim: true, maxlength: 4000 },
    status: {
      type: String,
      enum: ['open', 'in_progress', 'waiting_user', 'resolved', 'closed'],
      default: 'open',
      index: true
    },
    priority: {
      type: String,
      enum: ['low', 'normal', 'high', 'urgent'],
      default: 'normal',
      index: true
    },
    relatedEntityType: { type: String, default: '' },
    relatedEntityId: { type: mongoose.Schema.Types.ObjectId, default: null },
    attachments: [{ type: String }],
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    adminResponse: { type: String, default: '', maxlength: 4000 },
    resolvedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

supportTicketSchema.index({ user: 1, createdAt: -1 });

export const SupportTicket = mongoose.model('SupportTicket', supportTicketSchema);
