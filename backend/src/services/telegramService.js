import crypto from 'crypto';
import mongoose from 'mongoose';
import { AdminLog } from '../models/AdminLog.js';
import { User } from '../models/User.js';
import { Session } from '../models/Session.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

export const telegramService = {
  verifyTelegramWebAppData(initData) {
    const botToken = env.telegramBotToken;
    if (!botToken) {
      throw new AppError('Telegram bot token not configured', 500);
    }

    const data = new URLSearchParams(initData);
    const hash = data.get('hash');
    data.delete('hash');

    const authDate = data.get('auth_date');
    if (!authDate) {
      throw new AppError('Invalid Telegram data: missing auth_date', 400);
    }

    const now = Math.floor(Date.now() / 1000);
    if (now - parseInt(authDate) > 86400) {
      throw new AppError('Telegram data expired', 400);
    }

    const dataCheckString = Array.from(data.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (calculatedHash !== hash) {
      throw new AppError('Invalid Telegram signature', 400);
    }

    // Parse user data safely with try-catch
    let userData = {};
    try {
      const userJson = data.get('user');
      if (userJson) {
        userData = JSON.parse(userJson);
      }
    } catch (parseError) {
      console.error('[TelegramService] Invalid user JSON:', parseError);
      throw new AppError('Invalid user data format', 400);
    }

    return {
      id: userData.id || null,
      firstName: userData.first_name || null,
      lastName: userData.last_name || null,
      username: userData.username || null,
      languageCode: userData.language_code || null,
      photoUrl: userData.photo_url || null
    };
  },

  async handleTelegramAuth(telegramData) {
    const { id, firstName, lastName, username, languageCode } = telegramData;

    if (!id) {
      throw new AppError('Invalid Telegram user data', 400);
    }

    let user = await User.findOne({ telegramId: id });

    if (user) {
      user.telegramData = { id, firstName, lastName, username, languageCode };
      await user.save();
      return { user, isNew: false };
    }

    if (username) {
      user = await User.findOne({ username });
      if (user) {
        user.telegramId = id;
        user.telegramData = { id, firstName, lastName, username, languageCode };
        await user.save();
        return { user, isNew: false };
      }
    }

    return {
      telegramData: { id, firstName, lastName, username, languageCode },
      isNew: true
    };
  },

  async createSessionFromTelegram(userId, telegramData, req) {
    const sessionKey = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const session = await Session.create({
      user: userId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      telegramWebApp: true,
      telegramId: telegramData.id,
      sessionKey,
      expiresAt
    });

    return session;
  },

  async sendTelegramMessage(telegramId, message) {
    const botToken = env.telegramBotToken;
    if (!botToken) {
      throw new AppError('Telegram bot token not configured', 500);
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegramId,
          text: message,
          parse_mode: 'HTML'
        })
      });

      const data = await response.json();

      if (!data.ok) {
        throw new AppError(`Telegram API error: ${data.description}`, 500);
      }

      return data;
    } catch (error) {
      throw new AppError('Failed to send Telegram message', 500);
    }
  },

  async generateAndSendPassword(identifier, { requestedBy, reason = '' } = {}) {
    if (!requestedBy || !mongoose.Types.ObjectId.isValid(requestedBy)) {
      throw new AppError('Admin authorization required for password reset', 403);
    }
    const requester = await User.findById(requestedBy).select('role');
    if (!requester || requester.role !== 'admin') {
      throw new AppError('Admin authorization required for password reset', 403);
    }
    const user = await User.findOne({
      $or: [
        { username: identifier },
        { phone: identifier }
      ]
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    const newPassword = this.generateSecurePassword();
    const hashedPassword = await User.hashPassword(newPassword);
    const resetMethod = user.telegramId ? 'telegram' : 'support_whatsapp';
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        user.passwordHash = hashedPassword;
        await user.save({ session });
        await AdminLog.create([{
          admin: requester._id,
          action: 'password_reset',
          targetType: 'User',
          targetId: user._id,
          note: reason || 'Password reset via telegram service',
          metadata: { identifier, resetMethod }
        }], { session });
      });
    } finally {
      await session.endSession();
    }

    if (resetMethod === 'telegram') {
      const message = `
🔐 <b>Mot de passe réinitialisé</b>

Bonjour ${user.firstName} 👋

Votre nouveau mot de passe est: <code>${newPassword}</code>

⚠️ Veuillez le changer dès votre prochaine connexion pour plus de sécurité.

Si vous n'avez pas demandé cette réinitialisation, contactez le support immédiatement.
      `;

      await this.sendTelegramMessage(user.telegramId, message);
      return { sent: true, method: 'telegram' };
    } else {
      return {
        sent: false,
        method: 'whatsapp',
        whatsappNumber: '+2250100150593',
        message: 'Aucun compte Telegram lié. Contactez le support via WhatsApp.'
      };
    }
  },

  generateSecurePassword() {
    const length = 12;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return password;
  },

  async linkTelegramAccount(userId, telegramData) {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    const existingUser = await User.findOne({ telegramId: telegramData.id });
    if (existingUser && existingUser._id.toString() !== userId) {
      throw new AppError('Telegram account already linked to another user', 400);
    }

    user.telegramId = telegramData.id;
    user.telegramData = telegramData;
    await user.save();

    return user;
  },

  async unlinkTelegramAccount(userId) {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    user.telegramId = null;
    user.telegramData = {
      id: null,
      firstName: null,
      lastName: null,
      username: null,
      languageCode: null
    };
    user.telegramLinkCode = null;
    await user.save();

    return user;
  },

  generateLinkCode() {
    // Génère un code alphanumérique de 8 caractères
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  },

  async createLinkCode(userId) {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Générer un nouveau code
    const code = this.generateLinkCode();
    user.telegramLinkCode = code;
    await user.save();

    return { code, expiresIn: '10 minutes' };
  },

  async verifyLinkCode(code) {
    const user = await User.findOne({ telegramLinkCode: code });
    if (!user) {
      throw new AppError('Invalid or expired code', 400);
    }

    return user;
  },

  async getTelegramStatus(userId) {
    const user = await User.findById(userId).select('telegramId telegramData telegramLinkCode notificationPreferences.telegram');
    if (!user) {
      throw new AppError('User not found', 404);
    }

    return {
      isLinked: !!user.telegramId,
      telegramId: user.telegramId,
      telegramUsername: user.telegramData?.username || null,
      linkCode: user.telegramLinkCode,
      preferences: user.notificationPreferences?.telegram || {
        challenges: true,
        matches: true,
        results: true,
        wallet: true
      }
    };
  },

  async updateTelegramPreferences(userId, preferences) {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    user.notificationPreferences.telegram = {
      ...user.notificationPreferences.telegram,
      ...preferences
    };
    await user.save();

    return user.notificationPreferences.telegram;
  }
};
