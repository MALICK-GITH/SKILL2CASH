import express from 'express';
import { protect, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { generateAssistantReply, normalizeMessages } from '../services/assistantService.js';

export const assistantRouter = express.Router();

// User-facing assistant: available to any authenticated user.
assistantRouter.post('/chat', protect, asyncHandler(async (req, res) => {
  const message = req.body.message ?? req.body.prompt ?? '';
  const messages = normalizeMessages(req.body.messages || []);
  const view = req.body.view || 'global';
  // Never allow admin actions from the public assistant route.
  const reply = await generateAssistantReply({ req, message, messages, view, adminAction: null, confirmToken: '' });
  res.json(reply);
}));

// Admin assistant: supports privileged actions and admin-only flows.
assistantRouter.post('/admin/chat', protect, requireAdmin, asyncHandler(async (req, res) => {
  const message = req.body.message ?? req.body.prompt ?? '';
  const messages = normalizeMessages(req.body.messages || []);
  const view = req.body.view || 'global';
  const adminAction = req.body.adminAction && typeof req.body.adminAction === 'object' ? req.body.adminAction : null;
  const confirmToken = req.body.confirmToken ?? '';
  const reply = await generateAssistantReply({ req, message, messages, view, adminAction, confirmToken });
  res.json(reply);
}));
