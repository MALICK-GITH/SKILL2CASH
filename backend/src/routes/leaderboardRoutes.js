import express from 'express';
import { User } from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { buildTrustProfile } from '../services/trustService.js';

export const leaderboardRouter = express.Router();

leaderboardRouter.get('/', asyncHandler(async (req, res) => {
  const topEarnings = await User.find({ isBanned: false }).select('-passwordHash -email -blockedUsers').sort({ totalEarnings: -1 }).limit(20);
  const topWins = await User.find({ isBanned: false }).select('-passwordHash -email -blockedUsers').sort({ wins: -1 }).limit(20);
  const trustPool = await User.find({ isBanned: false })
    .select('username avatar country wins losses currentStreak maxStreak totalEarnings reputation reportsCount usernameLocked minStake maxStake rank status badge createdAt')
    .lean();
  const topTrust = trustPool
    .map((user) => ({ ...user, trustProfile: buildTrustProfile(user) }))
    .sort((a, b) => (b.trustProfile?.score || 0) - (a.trustProfile?.score || 0) || (b.wins || 0) - (a.wins || 0) || (b.totalEarnings || 0) - (a.totalEarnings || 0))
    .slice(0, 20);
  const topWinRate = await User.aggregate([
    { $match: { isBanned: false, wins: { $gte: 1 } } },
    { $addFields: { games: { $add: ['$wins', '$losses'] } } },
    { $addFields: { winRateCalc: { $multiply: [{ $divide: ['$wins', '$games'] }, 100] } } },
    { $sort: { winRateCalc: -1, wins: -1 } },
    { $limit: 20 },
    { $project: { passwordHash: 0, email: 0, blockedUsers: 0 } }
  ]);
  const byCountry = await User.aggregate([
    { $match: { isBanned: false } },
    { $group: { _id: '$country', players: { $sum: 1 }, earnings: { $sum: '$totalEarnings' }, wins: { $sum: '$wins' } } },
    { $sort: { earnings: -1 } },
    { $limit: 20 }
  ]);
  res.json({ topEarnings, topWins, topTrust, topWinRate, byCountry });
}));
