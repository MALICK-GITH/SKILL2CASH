import { Game } from '../models/Game.js';
import { AppError } from '../utils/AppError.js';

export const gameService = {
  async getAllGames(filters = {}) {
    const { isActive = true } = filters;
    const query = isActive !== undefined ? { isActive } : {};
    return await Game.find(query).sort({ name: 1 });
  },

  async getGameById(id) {
    const game = await Game.findById(id);
    if (!game) {
      throw new AppError('Game not found', 404);
    }
    return game;
  },

  async getGameBySlug(slug) {
    const game = await Game.findOne({ slug });
    if (!game) {
      throw new AppError('Game not found', 404);
    }
    return game;
  },

  async createGame(data) {
    const game = await Game.create(data);
    return game;
  },

  async updateGame(id, data) {
    const game = await Game.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    if (!game) {
      throw new AppError('Game not found', 404);
    }
    return game;
  },

  async deleteGame(id) {
    const game = await Game.findByIdAndDelete(id);
    if (!game) {
      throw new AppError('Game not found', 404);
    }
    return game;
  }
};
