import { Room } from '../models/Room.js';
import { Game } from '../models/Game.js';
import { Platform } from '../models/Platform.js';
import { AppError } from '../utils/AppError.js';

export const roomService = {
  async getAllRooms(filters = {}) {
    const { game, platform, minBet, maxBet, isActive = true, isFeatured } = filters;
    const query = {};

    if (isActive !== undefined) query.isActive = isActive;
    if (isFeatured !== undefined) query.isFeatured = isFeatured;
    if (game) query.game = game;
    if (platform) query.platform = platform;
    if (minBet) query.betAmount = { ...query.betAmount, $gte: minBet };
    if (maxBet) query.betAmount = { ...query.betAmount, $lte: maxBet };

    return await Room.find(query)
      .populate('game')
      .populate('platform')
      .sort({ isFeatured: -1, betAmount: 1 });
  },

  async getRoomById(id) {
    const room = await Room.findById(id)
      .populate('game')
      .populate('platform');
    if (!room) {
      throw new AppError('Room not found', 404);
    }
    return room;
  },

  async createRoom(data) {
    const { game, platform } = data;

    const gameDoc = await Game.findById(game);
    if (!gameDoc) {
      throw new AppError('Game not found', 404);
    }

    const platformDoc = await Platform.findById(platform);
    if (!platformDoc) {
      throw new AppError('Platform not found', 404);
    }

    const room = await Room.create(data);
    return await this.getRoomById(room._id);
  },

  async updateRoom(id, data) {
    const room = await Room.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    if (!room) {
      throw new AppError('Room not found', 404);
    }
    return await this.getRoomById(id);
  },

  async deleteRoom(id) {
    const room = await Room.findByIdAndDelete(id);
    if (!room) {
      throw new AppError('Room not found', 404);
    }
    return room;
  },

  async getFeaturedRooms() {
    return await this.getAllRooms({ isFeatured: true, isActive: true });
  },

  async calculatePotentialWin(roomId) {
    const room = await this.getRoomById(roomId);
    return {
      betAmount: room.betAmount,
      winMultiplier: room.winMultiplier,
      platformFee: room.platformFee,
      potentialWin: room.betAmount * room.winMultiplier,
      platformFeeAmount: room.betAmount * room.platformFee,
      netWin: room.betAmount * room.winMultiplier - room.betAmount * room.platformFee
    };
  }
};
