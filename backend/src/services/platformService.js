import { Platform } from '../models/Platform.js';
import { AppError } from '../utils/AppError.js';

export const platformService = {
  async getAllPlatforms(filters = {}) {
    const { isActive = true } = filters;
    const query = isActive !== undefined ? { isActive } : {};
    return await Platform.find(query).sort({ name: 1 });
  },

  async getPlatformById(id) {
    const platform = await Platform.findById(id);
    if (!platform) {
      throw new AppError('Platform not found', 404);
    }
    return platform;
  },

  async getPlatformBySlug(slug) {
    const platform = await Platform.findOne({ slug });
    if (!platform) {
      throw new AppError('Platform not found', 404);
    }
    return platform;
  },

  async createPlatform(data) {
    const platform = await Platform.create(data);
    return platform;
  },

  async updatePlatform(id, data) {
    const platform = await Platform.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    if (!platform) {
      throw new AppError('Platform not found', 404);
    }
    return platform;
  },

  async deletePlatform(id) {
    const platform = await Platform.findByIdAndDelete(id);
    if (!platform) {
      throw new AppError('Platform not found', 404);
    }
    return platform;
  }
};
