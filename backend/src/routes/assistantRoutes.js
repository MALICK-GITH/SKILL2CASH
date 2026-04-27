import express from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { generateAssistantReply, normalizeMessages } from '../services/assistantService.js';

export const assistantRouter = express.Router();

assistantRouter.post('/chat', asyncHandler(async (req, res) => {
  const message = req.body.message ?? req.body.prompt ?? '';
  const messages = normalizeMessages(req.body.messages || []);
  const view = req.body.view || 'global';
  const reply = await generateAssistantReply({ req, message, messages, view });
  res.json(reply);
}));
