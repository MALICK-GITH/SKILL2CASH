import mongoose from 'mongoose';
import { AdminLog } from '../models/AdminLog.js';

const auditLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    targetId: { type: mongoose.Schema.Types.ObjectId },
    targetType: { type: String },
    details: { type: Object, default: {} },
    ipAddress: { type: String },
    userAgent: { type: String },
    status: { type: String, enum: ['success', 'failed', 'pending'], default: 'success' },
    errorMessage: { type: String }
  },
  { timestamps: true }
);

auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ userId: 1, createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);

export async function logAudit(data) {
  try {
    await AuditLog.create(data);
  } catch (error) {
    console.error('Failed to log audit:', error);
  }
}

export async function logCriticalAction(action, userId, details = {}) {
  return logAudit({
    action,
    userId,
    details,
    status: 'success'
  });
}

export async function logError(action, userId, errorMessage, details = {}) {
  return logAudit({
    action,
    userId,
    details,
    status: 'failed',
    errorMessage
  });
}

export function getRequestAuditContext(req) {
  return {
    ipAddress: String(
      req?.ip
        || req?.headers?.['x-forwarded-for']?.split(',')?.[0]
        || req?.socket?.remoteAddress
        || ''
    ).trim(),
    userAgent: String(req?.headers?.['user-agent'] || '').trim()
  };
}

export async function logAdminAction({
  adminId,
  action,
  targetType,
  targetId,
  note = '',
  metadata = {},
  beforeState = null,
  afterState = null,
  req = null,
  status = 'success'
}) {
  const context = getRequestAuditContext(req);

  try {
    await AdminLog.create({
      admin: adminId,
      actorRole: 'admin',
      action,
      targetType,
      targetId,
      note,
      metadata,
      beforeState,
      afterState,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      status
    });
  } catch (error) {
    console.error('Failed to persist admin log:', error);
  }

  return logAudit({
    action: `admin:${action}`,
    userId: adminId,
    targetId,
    targetType,
    details: {
      metadata,
      note,
      beforeState,
      afterState,
      actorRole: 'admin'
    },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    status
  });
}
