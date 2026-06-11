import { GameProfile } from '../models/GameProfile.js';
import { Game } from '../models/Game.js';
import { Platform } from '../models/Platform.js';
import { AppError } from '../utils/AppError.js';

export const gameProfileService = {
  async getUserGameProfiles(userId, filters = {}) {
    const { game, platform } = filters;
    const query = { user: userId };
    if (game) query.game = game;
    if (platform) query.platform = platform;
    return await GameProfile.find(query)
      .populate('game')
      .populate('platform')
      .sort({ isPrimary: -1, createdAt: -1 });
  },

  async getGameProfileById(id) {
    const profile = await GameProfile.findById(id)
      .populate('game')
      .populate('platform')
      .populate('user', 'username firstName lastName avatar');
    if (!profile) {
      throw new AppError('Game profile not found', 404);
    }
    return profile;
  },

  async createGameProfile(userId, data) {
    const { game, platform, gamertag, isPrimary } = data;

    const gameDoc = await Game.findById(game);
    if (!gameDoc) {
      throw new AppError('Game not found', 404);
    }

    const platformDoc = await Platform.findById(platform);
    if (!platformDoc) {
      throw new AppError('Platform not found', 404);
    }

    const existingProfile = await GameProfile.findOne({ user: userId, game, platform });
    if (existingProfile) {
      throw new AppError('Profile already exists for this game and platform', 400);
    }

    if (isPrimary) {
      await GameProfile.updateMany({ user: userId, game }, { isPrimary: false });
    }

    const profile = await GameProfile.create({
      user: userId,
      game,
      platform,
      gamertag,
      isPrimary: isPrimary || false,
      ...data
    });

    return await this.getGameProfileById(profile._id);
  },

  async updateGameProfile(id, data) {
    const { isPrimary } = data;

    if (isPrimary) {
      const profile = await GameProfile.findById(id);
      if (profile) {
        await GameProfile.updateMany({ user: profile.user, game: profile.game }, { isPrimary: false });
      }
    }

    const updatedProfile = await GameProfile.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    if (!updatedProfile) {
      throw new AppError('Game profile not found', 404);
    }

    return await this.getGameProfileById(id);
  },

  async deleteGameProfile(id) {
    const profile = await GameProfile.findByIdAndDelete(id);
    if (!profile) {
      throw new AppError('Game profile not found', 404);
    }
    return profile;
  },

  async verifyGameProfile(id, adminId) {
    const profile = await GameProfile.findByIdAndUpdate(
      id,
      { isVerified: true, verifiedBy: adminId, verifiedAt: new Date() },
      { new: true }
    );
    if (!profile) {
      throw new AppError('Game profile not found', 404);
    }
    return await this.getGameProfileById(id);
  },

  async searchByGamertag(gamertag) {
    return await GameProfile.find({ gamertag: new RegExp(gamertag, 'i') })
      .populate('game')
      .populate('platform')
      .populate('user', 'username firstName lastName avatar');
  }
};
