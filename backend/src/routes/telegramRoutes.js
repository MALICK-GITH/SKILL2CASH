import crypto from 'crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { telegramService } from '../services/telegramService.js';
import { bot as telegramBot } from '../bot/telegramBot.js';
import { protect, requireAdmin, generateToken } from '../middleware/auth.js';
import { User } from '../models/User.js';
import { Session } from '../models/Session.js';

const router = express.Router();
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/webhook', async (req, res) => {
  try {
    if (!telegramBot) {
      res.status(503).json({ ok: false, message: 'Telegram bot not initialized' });
      return;
    }
    telegramBot.processUpdate(req.body);
    res.json({ ok: true });
  } catch (error) {
    console.error('[TELEGRAM] Webhook error:', error);
    res.status(500).json({ ok: false });
  }
});

router.post('/verify', async (req, res, next) => {
  try {
    const { initData } = req.body;
    if (!initData) {
      return res.status(400).json({ message: 'initData is required' });
    }

    // Vérifier et extraire les données Telegram
    const telegramData = telegramService.verifyTelegramWebAppData(initData);

    // Chercher si utilisateur existe déjà avec ce telegramId
    let user = await User.findOne({ telegramId: telegramData.id });
    let isNew = false;
    let isLinked = false;

    if (!user) {
      // === VÉRIFICATION: Compte existant avec même username ? ===
      // Éviter de créer un doublon si l'utilisateur a déjà un compte site web
      const existingByUsername = await User.findOne({
        username: telegramData.username,
        telegramId: { $exists: false } // Compte sans Telegram lié
      });

      if (existingByUsername && telegramData.username) {
        // Liaison automatique du compte existant avec Telegram
        console.log('[Telegram MiniApp] Linking existing account:', {
          userId: existingByUsername._id,
          username: existingByUsername.username,
          telegramId: telegramData.id
        });

        user = existingByUsername;
        user.telegramId = telegramData.id;
        user.telegramData = {
          username: telegramData.username,
          firstName: telegramData.firstName,
          lastName: telegramData.lastName,
          photoUrl: telegramData.photoUrl,
          languageCode: telegramData.languageCode
        };
        user.notificationPreferences.telegram = true;
        await user.save();

        isLinked = true;
      } else {
        // === NOUVEAU CLIENT: Création automatique ===
        isNew = true;

        // Générer un mot de passe aléatoire (jamais utilisé, connexion se fait via Telegram)
        const randomPassword = crypto.randomBytes(16).toString('hex');

        // Créer le compte
        user = await User.create({
          username: telegramData.username || `tg_${telegramData.id}`,
          email: `${telegramData.id}@telegram.user`, // Email factice unique
          password: randomPassword,
          telegramId: telegramData.id,
          telegramData: {
            username: telegramData.username,
            firstName: telegramData.firstName,
            lastName: telegramData.lastName,
            photoUrl: telegramData.photoUrl,
            languageCode: telegramData.languageCode
          },
          isTelegramUser: true, // Flag pour identifier les comptes Telegram-only
          emailVerified: true, // Pas besoin de vérifier email pour Telegram
          notificationPreferences: {
            telegram: true,
            push: true,
            email: false
          }
        });

        // Créer wallet
        const Wallet = (await import('../models/Wallet.js')).default;
        await Wallet.create({
          user: user._id,
          balanceAvailable: 0,
          balanceLocked: 0,
          balanceTotal: 0
        });

        console.log('[Telegram MiniApp] New user auto-created:', {
          userId: user._id,
          telegramId: telegramData.id,
          username: user.username
        });
      }
    } else {
      // === CLIENT EXISTANT: Mettre à jour les données Telegram ===
      user.telegramData = {
        username: telegramData.username,
        firstName: telegramData.firstName,
        lastName: telegramData.lastName,
        photoUrl: telegramData.photoUrl,
        languageCode: telegramData.languageCode
      };
      await user.save();
    }

    // Générer JWT token pour connexion automatique
    const token = generateToken(user._id);

    res.json({
      success: true,
      isNew, // true = nouveau compte créé, false = compte existant
      token, // Token JWT pour connexion auto
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        telegramId: user.telegramId,
        telegramLinked: true,
        balanceAvailable: user.balanceAvailable || 0,
        balanceLocked: user.balanceLocked || 0
      },
      telegramData: {
        id: telegramData.id,
        username: telegramData.username,
        firstName: telegramData.firstName,
        lastName: telegramData.lastName,
        photoUrl: telegramData.photoUrl
      },
      message: isNew
        ? 'Compte créé automatiquement via Telegram ! Bienvenue !'
        : isLinked
          ? 'Compte existant lié à Telegram ! Connecté !'
          : 'Connecté avec succès via Telegram !'
    });

  } catch (error) {
    next(error);
  }
});

router.post('/reset-password', protect, requireAdmin, resetPasswordLimiter, async (req, res, next) => {
  try {
    const { identifier } = req.body;
    const confirmed = req.body.confirmed === true || req.body.confirmed === 'true';
    if (!identifier) {
      return res.status(400).json({ message: 'Identifier (username or phone) is required' });
    }
    if (!confirmed) {
      return res.status(422).json({ message: 'Reset password requires explicit confirmation' });
    }

    const reason = String(req.body.reason || 'Reset demandé via panneau admin').trim().slice(0, 300);
    const result = await telegramService.generateAndSendPassword(identifier, {
      requestedBy: req.user._id,
      requestedByRole: req.user.role,
      reason
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/link', protect, async (req, res, next) => {
  try {
    const { initData } = req.body;
    if (!initData) {
      return res.status(400).json({ message: 'initData is required' });
    }

    const telegramData = telegramService.verifyTelegramWebAppData(initData);
    const user = await telegramService.linkTelegramAccount(req.user._id, telegramData);
    res.json(user);
  } catch (error) {
    next(error);
  }
});

router.post('/unlink', protect, async (req, res, next) => {
  try {
    const user = await telegramService.unlinkTelegramAccount(req.user._id);
    res.json(user);
  } catch (error) {
    next(error);
  }
});

// Obtenir le statut Telegram de l'utilisateur
router.get('/status', protect, async (req, res, next) => {
  try {
    const status = await telegramService.getTelegramStatus(req.user._id);
    res.json(status);
  } catch (error) {
    next(error);
  }
});

// Générer un code de liaison
router.post('/link-code', protect, async (req, res, next) => {
  try {
    const result = await telegramService.createLinkCode(req.user._id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Lien manuel via code (sans auth - pour Mini App fallback)
router.post('/link-manual', async (req, res, next) => {
  try {
    const { linkCode, telegramData } = req.body;
    if (!linkCode) {
      return res.status(400).json({ message: 'linkCode is required' });
    }

    // Vérifier le code
    const user = await telegramService.verifyLinkCode(linkCode);
    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired code' });
    }

    // Si telegramData fourni (depuis Mini App), l'utiliser
    if (telegramData && telegramData.id) {
      // Vérifier si ce telegramId est déjà lié à un autre compte
      const existingUser = await User.findOne({ telegramId: telegramData.id });
      if (existingUser && existingUser._id.toString() !== user._id.toString()) {
        return res.status(400).json({ message: 'Telegram account already linked to another user' });
      }

      user.telegramId = telegramData.id;
      user.telegramData = {
        id: telegramData.id,
        firstName: telegramData.firstName || null,
        lastName: telegramData.lastName || null,
        username: telegramData.username || null,
        languageCode: telegramData.languageCode || null
      };
    }

    // Invalider le code
    user.telegramLinkCode = null;
    await user.save();

    // Créer une session pour l'utilisateur
    const sessionKey = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await Session.create({
      user: user._id,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      telegramWebApp: true,
      telegramId: telegramData?.id || null,
      sessionKey,
      expiresAt
    });

    res.json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        efootballUsername: user.efootballUsername
      },
      sessionKey,
      message: 'Telegram linked successfully'
    });
  } catch (error) {
    next(error);
  }
});

// Mettre à jour les préférences de notification
router.patch('/preferences', protect, async (req, res, next) => {
  try {
    const preferences = await telegramService.updateTelegramPreferences(req.user._id, req.body);
    res.json(preferences);
  } catch (error) {
    next(error);
  }
});

export default router;
