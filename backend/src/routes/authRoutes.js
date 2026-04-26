import express from 'express';
import validator from 'validator';
import { User } from '../models/User.js';
import { protect } from '../middleware/auth.js';
import { requireFields } from '../middleware/validate.js';
import { ensureWallet } from '../services/walletService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { signToken } from '../utils/token.js';
import { usernameRegex, validateEfootballUsername } from '../utils/username.js';

export const authRouter = express.Router();

function serializeUser(user) {
  const obj = user.toObject ? user.toObject() : user;
  delete obj.passwordHash;
  return obj;
}

authRouter.post(
  '/register',
  requireFields(['email', 'password']),
  asyncHandler(async (req, res) => {
    const { email, password, country = 'Global' } = req.body;
    const username = validateEfootballUsername(req.body.efootballUsername || req.body.username);
    if (!validator.isEmail(email)) throw new AppError('Email invalide', 422);
    if (password.length < 8) throw new AppError('Le mot de passe doit contenir au moins 8 caractères', 422);

    const exists = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username: usernameRegex(username) }] });
    if (exists) throw new AppError('Nom d\'utilisateur ou email déjà utilisé', 409);

    const user = await User.create({
      username,
      efootballUsername: username,
      email,
      country,
      passwordHash: await User.hashPassword(password)
    });
    await ensureWallet(user._id);

    res.status(201).json({ token: signToken(user), user: serializeUser(user) });
  })
);

authRouter.post(
  '/login',
  requireFields(['email', 'password']),
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ email: String(req.body.email).toLowerCase() });
    if (!user || !(await user.comparePassword(req.body.password))) {
      throw new AppError('Identifiants invalides', 401);
    }
    if (user.isBanned) throw new AppError('Compte banni', 403);

    res.json({ token: signToken(user), user: serializeUser(user) });
  })
);

authRouter.get('/me', protect, asyncHandler(async (req, res) => {
  res.json({ user: req.user });
}));
