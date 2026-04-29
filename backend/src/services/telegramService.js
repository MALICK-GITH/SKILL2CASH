import crypto from 'crypto';
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

    return {
      id: data.get('user') ? JSON.parse(data.get('user')).id : null,
      firstName: data.get('user') ? JSON.parse(data.get('user')).first_name : null,
      lastName: data.get('user') ? JSON.parse(data.get('user')).last_name : null,
      username: data.get('user') ? JSON.parse(data.get('user')).username : null,
      languageCode: data.get('user') ? JSON.parse(data.get('user')).language_code : null
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

  async generateAndSendPassword(identifier) {
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

    user.passwordHash = hashedPassword;
    await user.save();

    if (user.telegramId) {
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
    await user.save();

    return user;
  }
};
