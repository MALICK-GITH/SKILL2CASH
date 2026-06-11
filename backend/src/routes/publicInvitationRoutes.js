import express from 'express';
import { publicInvitationService } from '../services/publicInvitationService.js';
import { protect, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const invitations = await publicInvitationService.getAllInvitations(req.query);
    res.json(invitations);
  } catch (error) {
    next(error);
  }
});

router.get('/open', async (req, res, next) => {
  try {
    const invitations = await publicInvitationService.getAllInvitations({ status: 'open', ...req.query });
    res.json(invitations);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const invitation = await publicInvitationService.getInvitationById(req.params.id);
    res.json(invitation);
  } catch (error) {
    next(error);
  }
});

router.post('/', protect, async (req, res, next) => {
  try {
    const invitation = await publicInvitationService.createInvitation(req.user._id, req.body);
    res.status(201).json(invitation);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/accept', protect, async (req, res, next) => {
  try {
    const { acceptorGameProfileId } = req.body;
    const invitation = await publicInvitationService.acceptInvitation(req.params.id, req.user._id, acceptorGameProfileId);
    res.json(invitation);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/close', protect, async (req, res, next) => {
  try {
    const invitation = await publicInvitationService.closeInvitation(req.params.id, req.user._id);
    res.json(invitation);
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', protect, requireAdmin, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    await publicInvitationService.cancelInvitation(req.params.id, req.user._id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
