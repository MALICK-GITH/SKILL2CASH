import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const protect = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    throw new AppError('Authentification requise', 401);
  }

  let decoded;
  try {
    decoded = jwt.verify(token, env.jwtSecret);
  } catch {
    throw new AppError('Session expirée ou invalide', 401);
  }

  const user = await User.findById(decoded.id).select('-passwordHash');

  if (!user || user.isBanned) {
    throw new AppError('Utilisateur invalide ou banni', 401);
  }

  req.user = user;
  next();
});

export function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') {
    throw new AppError('Accès admin requis', 403);
  }
  next();
}
