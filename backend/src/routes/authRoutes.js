import express from 'express';
import validator from 'validator';
import { User } from '../models/User.js';
import { protect } from '../middleware/auth.js';
import { requireFields } from '../middleware/validate.js';
import { attachWalletsToUsers, ensureWallet } from '../services/walletService.js';
import { notifyAdmins, notifyUser } from '../services/notificationService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { signToken } from '../utils/token.js';
import { usernameRegex, validateEfootballUsername } from '../utils/username.js';
import { Duel } from '../models/Duel.js';

export const authRouter = express.Router();

function generateTempPhone() {
  return `TEMP${Date.now().toString(36).toUpperCase()}`;
}

function generateUsernameFromEmail(email) {
  const [localPart, domain = ''] = email.split('@');
  let prefix = localPart.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12);
  // Fallback si le préfixe est vide (email comme @@example.com ou caractères spéciaux)
  if (!prefix) {
    prefix = (domain.split('.')[0] || 'user').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 8);
  }
  const suffix = Math.random().toString(36).substring(2, 6);
  return `${prefix || 'user'}_${suffix}`;
}

async function generateUniqueUsername(email) {
  let username = generateUsernameFromEmail(email);
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    const exists = await User.findOne({ username: usernameRegex(username) });
    if (!exists) return username;
    // Regenerate with new suffix
    const [base] = username.split('_');
    const newSuffix = Math.random().toString(36).substring(2, 6);
    username = `${base}_${newSuffix}`;
    attempts++;
  }

  // Last resort: add timestamp
  return `user_${Date.now().toString(36).substring(2, 8)}`;
}

function serializeUser(user) {
  const obj = user.toObject ? user.toObject() : user;
  delete obj.passwordHash;
  return obj;
}

async function serializeUserWithWallet(user) {
  const [serialized] = await attachWalletsToUsers([serializeUser(user)]);
  return serialized;
}

authRouter.post(
  '/register',
  requireFields(['username', 'efootballUsername', 'firstName', 'lastName', 'phone', 'email', 'password']),
  asyncHandler(async (req, res) => {
    const { email, password, firstName, lastName, phone, country = 'Global' } = req.body;
    const username = validateEfootballUsername(req.body.username || req.body.skill2cashUsername);
    const efootballUsername = validateEfootballUsername(req.body.efootballUsername || req.body.username);
    if (!validator.isEmail(email)) throw new AppError('Email invalide', 422);
    if (password.length < 8) throw new AppError('Le mot de passe doit contenir au moins 8 caractères', 422);

    const exists = await User.findOne({
      $or: [
        { email: email.toLowerCase() },
        { phone: String(phone).trim() },
        { username: usernameRegex(username) },
        { efootballUsername: usernameRegex(efootballUsername) }
      ]
    });
    if (exists) throw new AppError('Nom d\'utilisateur ou email déjà utilisé', 409);

    const user = await User.create({
      username,
      efootballUsername,
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      email,
      phone: String(phone).trim(),
      country,
      passwordHash: await User.hashPassword(password)
    });
    await ensureWallet(user._id);
    await notifyAdmins('admin:new_user', {
      title: 'Nouvel utilisateur',
      body: `${user.efootballUsername} vient de créer un compte.`,
      userId: user._id,
      username: user.username,
      efootballUsername: user.efootballUsername
    });

    res.status(201).json({ token: signToken(user), user: await serializeUserWithWallet(user) });
  })
);

authRouter.post(
  '/register-quick',
  requireFields(['email', 'password', 'efootballUsername']),
  asyncHandler(async (req, res) => {
    const { email, password, efootballUsername } = req.body;

    if (!validator.isEmail(email)) throw new AppError('Email invalide', 422);
    if (password.length < 8) throw new AppError('Le mot de passe doit contenir au moins 8 caractères', 422);

    const finalEfootballUsername = validateEfootballUsername(efootballUsername);

    const emailExists = await User.findOne({ email: email.toLowerCase() });
    if (emailExists) throw new AppError('Email déjà utilisé', 409);

    const efootballExists = await User.findOne({
      $or: [
        { efootballUsername: usernameRegex(finalEfootballUsername) },
        { username: usernameRegex(finalEfootballUsername) }
      ]
    });
    if (efootballExists) throw new AppError('Pseudo eFootball déjà utilisé', 409);

    const generatedUsername = await generateUniqueUsername(email);
    const tempPhone = generateTempPhone();

    try {
      const user = await User.create({
        username: generatedUsername,
        efootballUsername: finalEfootballUsername,
        firstName: 'Player',
        lastName: finalEfootballUsername,
        email,
        phone: tempPhone,
        country: 'Global',
        passwordHash: await User.hashPassword(password)
      });

      await ensureWallet(user._id);
      await notifyAdmins('admin:new_user_quick', {
        title: 'Nouveau joueur (inscription rapide)',
        body: `${finalEfootballUsername} s'est inscrit rapidement.`,
        userId: user._id,
        email: user.email
      });

      res.status(201).json({
        success: true,
        message: 'Compte créé avec succès ! Complétez votre profil quand vous voulez.',
        token: signToken(user),
        user: await serializeUserWithWallet(user)
      });
    } catch (error) {
      // Gérer les duplicate key errors MongoDB (race condition sur l'unicité)
      if (error.code === 11000) {
        const field = Object.keys(error.keyValue || {})[0];
        throw new AppError(`${field} déjà utilisé. Veuillez réessayer.`, 409);
      }
      throw error;
    }
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

    await notifyUser(user._id, 'auth:login', {
      userId: user._id,
      username: user.username,
      efootballUsername: user.efootballUsername
    });
    res.json({ token: signToken(user), user: await serializeUserWithWallet(user) });
  })
);

authRouter.get('/me', protect, asyncHandler(async (req, res) => {
  const [user] = await attachWalletsToUsers([req.user]);
  res.json({ user });
}));

authRouter.patch('/complete-profile', protect, asyncHandler(async (req, res) => {
  const { firstName, lastName, phone, country, efootballUsername } = req.body;
  const updates = {};

  // Get current user for phone validation
  const currentUser = await User.findById(req.user._id);
  if (!currentUser) throw new AppError('Utilisateur non trouvé', 404);

  if (firstName) updates.firstName = String(firstName).trim();
  if (lastName) updates.lastName = String(lastName).trim();

  // Phone validation: reject new TEMP values, allow TEMP -> real number
  if (phone !== undefined) {
    const newPhone = String(phone).trim();
    const currentPhone = currentUser.phone || '';

    // Reject if new phone starts with TEMP
    if (newPhone.startsWith('TEMP')) {
      throw new AppError('Numéro de téléphone invalide (format TEMP non autorisé)', 422);
    }

    // Allow: current TEMP -> new real number
    // Allow: current real -> new real number
    if (newPhone !== currentPhone) {
      const phoneExists = await User.findOne({ phone: newPhone, _id: { $ne: req.user._id } });
      if (phoneExists) throw new AppError('Numéro de téléphone déjà utilisé', 409);
      updates.phone = newPhone;
    }
  }

  if (country) updates.country = String(country).trim();

  // Block efootballUsername change if user has match proofs
  if (efootballUsername) {
    // Check if user has submitted any match proofs
    const hasProofs = await Duel.exists({
      $or: [{ player1: req.user._id }, { player2: req.user._id }],
      $or: [{ 'resultPlayer1.screenshot': { $exists: true, $ne: '' } },
      { 'resultPlayer2.screenshot': { $exists: true, $ne: '' } }]
    });

    if (hasProofs) {
      throw new AppError('Impossible de modifier le pseudo eFootball : des preuves de match existent. Contactez l\'administrateur.', 403);
    }

    const cleanUsername = validateEfootballUsername(efootballUsername);
    const usernameExists = await User.findOne({
      $or: [
        { efootballUsername: usernameRegex(cleanUsername) },
        { username: usernameRegex(cleanUsername) }
      ],
      _id: { $ne: req.user._id }
    });
    if (usernameExists) throw new AppError('Pseudo eFootball déjà utilisé', 409);
    updates.efootballUsername = cleanUsername;
    updates.username = cleanUsername;
  }

  if (Object.keys(updates).length === 0) {
    throw new AppError('Aucune donnée à mettre à jour', 422);
  }

  const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true });
  res.json({
    success: true,
    message: 'Profil mis à jour avec succès',
    user: await serializeUserWithWallet(user)
  });
}));
