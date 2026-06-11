import { SupportTicket } from '../models/SupportTicket.js';
import { AppError } from '../utils/AppError.js';
import { notifyAdmins, notifyUser } from './notificationService.js';
import { logAdminAction } from './auditLogService.js';

export async function createSupportTicket(userId, payload = {}) {
  const subject = String(payload.subject || '').trim();
  const message = String(payload.message || '').trim();
  const category = String(payload.category || 'other').trim();
  const attachments = Array.isArray(payload.attachments) ? payload.attachments.filter(Boolean).slice(0, 5) : [];

  if (!subject) throw new AppError('Le sujet du ticket est requis', 422);
  if (!message) throw new AppError('Le message du ticket est requis', 422);

  const ticket = await SupportTicket.create({
    user: userId,
    category,
    subject,
    message,
    priority: payload.priority || 'normal',
    relatedEntityType: payload.relatedEntityType || '',
    relatedEntityId: payload.relatedEntityId || null,
    attachments
  });

  await notifyAdmins('admin_alert', {
    title: 'Nouveau ticket support',
    body: `${subject} (${category})`,
    ticketId: ticket._id,
    userId
  });

  return ticket;
}

export async function replyToSupportTicket(ticketId, adminUser, payload = {}, req = null) {
  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) throw new AppError('Ticket introuvable', 404);

  const beforeState = ticket.toObject();
  ticket.status = payload.status || 'resolved';
  ticket.priority = payload.priority || ticket.priority;
  ticket.assignedTo = adminUser._id;
  ticket.adminResponse = String(payload.adminResponse || '').trim();
  if (ticket.status === 'resolved' || ticket.status === 'closed') {
    ticket.resolvedAt = new Date();
  }
  await ticket.save();

  await logAdminAction({
    adminId: adminUser._id,
    action: 'support_ticket_updated',
    targetType: 'SupportTicket',
    targetId: ticket._id,
    note: ticket.adminResponse,
    metadata: { status: ticket.status, priority: ticket.priority },
    beforeState,
    afterState: ticket.toObject(),
    req
  });

  await notifyUser(ticket.user, 'admin_alert', {
    title: 'Réponse support',
    body: ticket.adminResponse || 'Votre ticket a été mis à jour.',
    ticketId: ticket._id,
    status: ticket.status
  });

  return ticket;
}
