import { PublicInvitation } from '../models/PublicInvitation.js';
import { Room } from '../models/Room.js';
import { GameProfile } from '../models/GameProfile.js';
import { Challenge } from '../models/Challenge.js';
import { lockFunds, unlockFunds, getWalletByUser } from './walletService.js';
import { AppError } from '../utils/AppError.js';
import crypto from 'crypto';

export const publicInvitationService = {
  async getAllInvitations(filters = {}) {
    const { status, host, room } = filters;
    const query = {};
    if (status) query.status = status;
    if (host) query.host = host;
    if (room) query.room = room;
    return await PublicInvitation.find(query)
      .populate('host', 'username firstName lastName avatar')
      .populate('room')
      .populate('gameProfile')
      .populate('acceptedBy', 'username firstName lastName avatar')
      .sort({ isFeatured: -1, createdAt: -1 });
  },

  async getInvitationById(id) {
    const invitation = await PublicInvitation.findById(id)
      .populate('host', 'username firstName lastName avatar')
      .populate('room')
      .populate('gameProfile')
      .populate('acceptedBy', 'username firstName lastName avatar')
      .populate('challenge');
    if (!invitation) {
      throw new AppError('Invitation not found', 404);
    }
    return invitation;
  },

  async createInvitation(hostId, data) {
    const { room, gameProfile, mode, scheduledTime, notes, expiresHours = 24 } = data;

    const roomDoc = await Room.findById(room);
    if (!roomDoc) {
      throw new AppError('Room not found', 404);
    }

    const profileDoc = await GameProfile.findById(gameProfile);
    if (!profileDoc) {
      throw new AppError('Game profile not found', 404);
    }

    if (profileDoc.user._id.toString() !== hostId.toString()) {
      throw new AppError('Game profile does not belong to host', 400);
    }

    const wallet = await walletService.walletService.getWalletByUser(hostId);
    if (wallet.balanceAvailable < roomDoc.betAmount) {
      throw new AppError('Insufficient balance', 400);
    }

    await wawletService.lalletService.lockFunds(hostId, roomDoc.betAmount);

    const expiresAt = new Date(Date.now() + expiresHours * 60 * 60 * 1000);

    const invitation = await PublicInvitation.create({
      host: hostId,
      room,
      gameProfile,
      mode,
      scheduledTime,
      notes,
      expiresAt
    });

    return await this.getInvitationById(invitation._id);
  },

  async acceptInvitation(id, acceptorId, acceptorGameProfileId) {
    const invitation = await this.getInvitationById(id);

    if (invitation.status !== 'open') {
      throw new AppError('Invitation is not open', 400);
    }

    if (invitation.host._id.toString() === acceptorId.toString()) {
      throw new AppError('Cannot accept your own invitation', 400);
    }

    if (new Date() > new Date(invitation.expiresAt)) {
      await unlockFunds(invitation.host._id, invitation.room.betAmount);
      await PublicInvitation.findByIdAndUpdate(id, { status: 'expired' });
      throw new AppError('Invitation has expired', 400);
    }

    const acceptorProfile = await GameProfile.findById(acceptorGameProfileId);
    if (!acceptorProfile) {
      throw new AppError('Game profile not found', 404);
    }

    if (acceptorProfile.user._id.toString() !== acceptorId.toString()) {
      throw new AppError('Game profile does not belong to acceptor', 400);
    }

    const wallet = await getWalletByUser(acceptorId);
    if (wallet.balanceAvailable < invitation.room.betAmount) {
      throw new AppError('Insufficient balance', 400);
    }

    await lockFunds(acceptorId, invitation.room.betAmount);

    const matchCode = 'MAT-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const roomId = crypto.randomBytes(8).toString('hex');

    const challenge = await Challenge.create({
      challenger: invitation.host._id,
      challenged: acceptorId,
      challengerGameProfile: invitation.gameProfile._id,
      challengedGameProfile: acceptorGameProfileId,
      room: invitation.room._id,
      amount: invitation.room.betAmount,
      matchType: invitation.mode,
      message: invitation.notes,
      status: 'accepted',
      scheduledTime: invitation.scheduledTime,
      matchCode,
      roomId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });

    const updatedInvitation = await PublicInvitation.findByIdAndUpdate(
      id,
      { 
        status: 'accepted',
        acceptedBy: acceptorId,
        acceptedAt: new Date(),
        challenge: challenge._id
      },
      { new: true }
    );

    return await this.getInvitationById(id);
  },

  async closeInvitation(id, hostId) {
    const invitation = await this.getInvitationById(id);

    if (invitation.host._id.toString() !== hostId.toString()) {
      throw new AppError('Only host can close invitation', 403);
    }

    if (invitation.status !== 'open') {
      throw new AppError('Invitation is not open', 400);
    }

    await unlockFunds(hostId, invitation.room.betAmount);

    const updatedInvitation = await PublicInvitation.findByIdAndUpdate(
      id,
      { status: 'closed' },
      { new: true }
    );

    return await this.getInvitationById(id);
  },

  async cancelInvitation(id, adminId) {
    const invitation = await this.getInvitationById(id);

    if (invitation.status === 'open') {
      await unlockFunds(invitation.host._id, invitation.room.betAmount);
    }

    const updatedInvitation = await PublicInvitation.findByIdAndUpdate(
      id,
      { status: 'cancelled' },
      { new: true }
    );

    return await this.getInvitationById(id);
  },

  async expireInvitations() {
    const expiredInvitations = await PublicInvitation.find({
      status: 'open',
      expiresAt: { $lt: new Date() }
    });

    for (const invitation of expiredInvitations) {
      await unlockFunds(invitation.host, invitation.room.betAmount);
      await PublicInvitation.findByIdAndUpdate(invitation._id, { status: 'expired' });
    }

    return expiredInvitations.length;
  }
};
