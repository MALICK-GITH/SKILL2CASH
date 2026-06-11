import express from 'express';
import { protect, requireAdmin } from '../middleware/auth.js';
import { requireFields } from '../middleware/validate.js';
import { SupportTicket } from '../models/SupportTicket.js';
import { createSupportTicket, replyToSupportTicket } from '../services/supportTicketService.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const supportTicketRouter = express.Router();
supportTicketRouter.use(protect);

supportTicketRouter.get('/', asyncHandler(async (req, res) => {
  const filter = req.user.role === 'admin'
    ? {}
    : { user: req.user._id };

  if (req.query.status) filter.status = req.query.status;
  if (req.query.category) filter.category = req.query.category;

  const tickets = await SupportTicket.find(filter)
    .populate('user assignedTo', 'username efootballUsername email')
    .sort({ createdAt: -1 })
    .limit(100);

  res.json({ tickets });
}));

supportTicketRouter.post('/', requireFields(['category', 'subject', 'message']), asyncHandler(async (req, res) => {
  const ticket = await createSupportTicket(req.user._id, req.body);
  res.status(201).json({ ticket });
}));

supportTicketRouter.patch('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const ticket = await replyToSupportTicket(req.params.id, req.user, req.body, req);
  res.json({ ticket });
}));
