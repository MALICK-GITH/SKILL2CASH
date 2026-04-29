import { ChatMessage } from '../models/ChatMessage.js';
import { Challenge } from '../models/Challenge.js';
import { AppError } from '../utils/AppError.js';

export const chatMessageService = {
  async getMessagesByChallenge(challengeId, options = {}) {
    const { limit = 50, skip = 0 } = options;
    const challenge = await Challenge.findById(challengeId);
    if (!challenge) {
      throw new AppError('Challenge not found', 404);
    }

    return await ChatMessage.find({ challenge: challengeId })
      .populate('sender', 'username firstName lastName avatar')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip);
  },

  async getMessageById(id) {
    const message = await ChatMessage.findById(id)
      .populate('sender', 'username firstName lastName avatar')
      .populate('challenge');
    if (!message) {
      throw new AppError('Message not found', 404);
    }
    return message;
  },

  async createMessage(challengeId, senderId, data) {
    const { message, isSystem = false, metadata = {} } = data;

    const challenge = await Challenge.findById(challengeId);
    if (!challenge) {
      throw new AppError('Challenge not found', 404);
    }

    const isParticipant = 
      challenge.challenger.toString() === senderId.toString() ||
      challenge.challenged.toString() === senderId.toString();

    if (!isSystem && !isParticipant) {
      throw new AppError('Only participants can send messages', 403);
    }

    const chatMessage = await ChatMessage.create({
      challenge: challengeId,
      sender: senderId,
      message,
      isSystem,
      metadata
    });

    return await this.getMessageById(chatMessage._id);
  },

  async createSystemMessage(challengeId, message, metadata = {}) {
    return await this.createMessage(challengeId, null, { message, isSystem: true, metadata });
  },

  async deleteMessage(id, userId, userRole) {
    const message = await this.getMessageById(id);

    if (message.sender._id.toString() !== userId.toString() && userRole !== 'admin') {
      throw new AppError('Access denied', 403);
    }

    await ChatMessage.findByIdAndDelete(id);
    return message;
  },

  async getUnreadCount(challengeId, userId) {
    const challenge = await Challenge.findById(challengeId);
    if (!challenge) {
      throw new AppError('Challenge not found', 404);
    }

    const lastReadAt = challenge.chatLastReadAt?.get(userId.toString()) || new Date(0);

    const count = await ChatMessage.countDocuments({
      challenge: challengeId,
      sender: { $ne: userId },
      createdAt: { $gt: lastReadAt }
    });

    return count;
  },

  async markAsRead(challengeId, userId) {
    const challenge = await Challenge.findById(challengeId);
    if (!challenge) {
      throw new AppError('Challenge not found', 404);
    }

    if (!challenge.chatLastReadAt) {
      challenge.chatLastReadAt = new Map();
    }
    challenge.chatLastReadAt.set(userId.toString(), new Date());
    await challenge.save();

    return { success: true };
  }
};
