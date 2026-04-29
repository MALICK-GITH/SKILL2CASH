import { Stream } from '../models/Stream.js';
import { Duel } from '../models/Duel.js';
import { AppError } from '../utils/AppError.js';
import crypto from 'crypto';

export const streamService = {
  async getAllStreams(filters = {}) {
    const { status, duel } = filters;
    const query = {};
    if (status) query.status = status;
    if (duel) query.duel = duel;
    return await Stream.find(query)
      .populate('duel')
      .sort({ scheduledStartTime: -1 });
  },

  async getStreamById(id) {
    const stream = await Stream.findById(id).populate('duel');
    if (!stream) {
      throw new AppError('Stream not found', 404);
    }
    return stream;
  },

  async getStreamByDuel(duelId) {
    const stream = await Stream.findOne({ duel: duelId }).populate('duel');
    if (!stream) {
      throw new AppError('Stream not found for this duel', 404);
    }
    return stream;
  },

  async createStream(duelId, data) {
    const duel = await Duel.findById(duelId);
    if (!duel) {
      throw new AppError('Duel not found', 404);
    }

    const existingStream = await Stream.findOne({ duel: duelId });
    if (existingStream) {
      throw new AppError('Stream already exists for this duel', 400);
    }

    const streamKey = crypto.randomBytes(32).toString('hex');

    const stream = await Stream.create({
      duel: duelId,
      streamKey,
      ...data
    });

    return await this.getStreamById(stream._id);
  },

  async updateStream(id, data) {
    const stream = await Stream.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    if (!stream) {
      throw new AppError('Stream not found', 404);
    }
    return await this.getStreamById(id);
  },

  async startStream(id) {
    const stream = await Stream.findByIdAndUpdate(
      id,
      { status: 'live', actualStartTime: new Date() },
      { new: true }
    );
    if (!stream) {
      throw new AppError('Stream not found', 404);
    }
    return await this.getStreamById(id);
  },

  async endStream(id, vodUrl = '') {
    const stream = await Stream.findByIdAndUpdate(
      id,
      { 
        status: 'ended', 
        endTime: new Date(),
        vodUrl
      },
      { new: true }
    );
    if (!stream) {
      throw new AppError('Stream not found', 404);
    }
    return await this.getStreamById(id);
  },

  async cancelStream(id) {
    const stream = await Stream.findByIdAndUpdate(
      id,
      { status: 'cancelled' },
      { new: true }
    );
    if (!stream) {
      throw new AppError('Stream not found', 404);
    }
    return await this.getStreamById(id);
  },

  async updatePeakViewers(id, viewers) {
    const stream = await Stream.findById(id);
    if (!stream) {
      throw new AppError('Stream not found', 404);
    }
    if (viewers > stream.peakViewers) {
      stream.peakViewers = viewers;
      await stream.save();
    }
    return stream;
  },

  async deleteStream(id) {
    const stream = await Stream.findByIdAndDelete(id);
    if (!stream) {
      throw new AppError('Stream not found', 404);
    }
    return stream;
  }
};
