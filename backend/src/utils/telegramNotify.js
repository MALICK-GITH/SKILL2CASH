/**
 * SKILL2CASH - Système de notifications Telegram
 * Gestion complète des notifications avec retry, logs et haute disponibilité
 * Optimisé pour 1000+ joueurs simultanés
 * 
 * @author SOLITAIRE HACK
 * @version 1.0.0
 */

import { bot } from '../bot/telegramBot.js';
import { User } from '../models/User.js';

// Configuration du système de retry
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000, // 1 seconde
  maxDelay: 10000, // 10 secondes
  backoffMultiplier: 2
};

// Queue de messages pour gérer la charge (rate limiting)
const messageQueue = [];
let isProcessingQueue = false;
const RATE_LIMIT = 30; // messages par seconde
let messagesInLastSecond = 0;
let lastSecondTimestamp = Date.now();

/**
 * Attend un délai spécifié
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Calcul du délai exponentiel pour retry
 */
const calculateBackoff = (attempt) => {
  const delay = RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt);
  return Math.min(delay, RETRY_CONFIG.maxDelay);
};

/**
 * Exécute une fonction avec retry automatique
 */
async function withRetry(operation, context) {
  let lastError;

  for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = calculateBackoff(attempt - 1);
        console.log(`[TELEGRAM RETRY] ${context} - Tentative ${attempt + 1}/${RETRY_CONFIG.maxRetries} après ${delay}ms`);
        await sleep(delay);
      }

      return await operation();
    } catch (error) {
      lastError = error;

      // Ne pas retry sur certaines erreurs
      if (error.code === 'ETELEGRAM' &&
        (error.response?.body?.description?.includes('blocked') ||
          error.response?.body?.description?.includes('not found'))) {
        console.log(`[TELEGRAM SKIP] ${context} - Utilisateur inaccessible, abandon`);
        return null;
      }

      console.error(`[TELEGRAM ERROR] ${context} - Tentative ${attempt + 1} échouée:`, error.message);
    }
  }

  console.error(`[TELEGRAM FAILED] ${context} - Toutes les tentatives échouées après ${RETRY_CONFIG.maxRetries} essais`);
  throw lastError;
}

/**
 * Vérifie si un utilisateur a activé les notifications Telegram
 */
async function shouldNotifyTelegram(userId) {
  try {
    const user = await User.findById(userId).select('telegramId notificationPreferences telegramData');

    if (!user?.telegramId) {
      return { shouldNotify: false, reason: 'no_telegram_id' };
    }

    // Vérifier les préférences (par défaut true si non défini)
    const telegramPrefs = user.notificationPreferences?.telegram;
    const enabled = telegramPrefs !== false; // Si undefined ou true, c'est activé

    if (!enabled) {
      return { shouldNotify: false, reason: 'notifications_disabled' };
    }

    return {
      shouldNotify: true,
      telegramId: user.telegramId,
      telegramData: user.telegramData
    };
  } catch (error) {
    console.error('[TELEGRAM NOTIFY CHECK ERROR]', error);
    return { shouldNotify: false, reason: 'error' };
  }
}

/**
 * Envoie un message avec gestion de file d'attente pour haute charge
 */
async function sendTelegramMessage(telegramId, message, options = {}) {
  if (!bot) {
    console.log('[TELEGRAM BOT] Bot non initialisé, message non envoyé');
    return null;
  }

  // Rate limiting simple
  const now = Date.now();
  if (now - lastSecondTimestamp >= 1000) {
    messagesInLastSecond = 0;
    lastSecondTimestamp = now;
  }

  if (messagesInLastSecond >= RATE_LIMIT) {
    // Attendre le prochain slot
    await sleep(1000 - (now - lastSecondTimestamp));
    messagesInLastSecond = 0;
    lastSecondTimestamp = Date.now();
  }

  messagesInLastSecond++;

  return withRetry(async () => {
    const result = await bot.sendMessage(telegramId, message, {
      parse_mode: 'HTML',
      ...options
    });

    console.log(`[TELEGRAM SENT] Message envoyé à ${telegramId}`);
    return result;
  }, `sendMessage to ${telegramId}`);
}

/**
 * 🎯 Notification : Nouveau défi reçu
 * Avec boutons Accepter / Refuser / Ouvrir Mini App
 */
export async function notifyChallenge(userId, challenge, challengerInfo) {
  const check = await shouldNotifyTelegram(userId);
  if (!check.shouldNotify) {
    console.log(`[TELEGRAM SKIP] notifyChallenge - ${check.reason} pour user ${userId}`);
    return null;
  }

  const { telegramId } = check;
  const amount = challenge.amount?.toLocaleString('fr-FR') || '0';
  const challengerName = challengerInfo?.efootballUsername || challengerInfo?.username || 'Adversaire';

  const message = `🎯 <b>NOUVEAU DÉFI REÇU !</b>

👤 <b>${challengerName}</b> vient de te défier !
💰 Mise : <b>${amount} FCFA</b>
⏱ Temps restant : 30 minutes

Tu peux accepter directement ici ou ouvrir la salle de match.`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ Accepter', callback_data: `challenge_accept:${challenge._id}` },
        { text: '❌ Refuser', callback_data: `challenge_decline:${challenge._id}` }
      ],
      [
        {
          text: '🎮 Ouvrir la salle',
          web_app: { url: `${process.env.CLIENT_URL || 'https://skill2cash-yrgx.onrender.com'}/?view=duels&id=${challenge._id}` }
        }
      ]
    ]
  };

  return sendTelegramMessage(telegramId, message, { reply_markup: keyboard });
}

/**
 * ✅ Notification : Défi accepté (envoyé aux deux joueurs)
 */
export async function notifyChallengeAccepted(challenge, duel, challenger, challenged) {
  const baseMessage = (name, opponentName, amount, roomId) =>
    `✅ <b>DÉFI ACCEPTÉ !</b>

Le défi contre <b>${opponentName}</b> a été accepté !
💰 Mise : <b>${amount.toLocaleString('fr-FR')} FCFA</b>
🏟 Salle : <code>${roomId}</code>

Prépare-toi, le match va commencer ! 🎮`;

  const results = [];

  // Notifier le challenger (celui qui a créé le défi)
  const challengerCheck = await shouldNotifyTelegram(challenger._id);
  if (challengerCheck.shouldNotify) {
    const challengedName = challenged.efootballUsername || challenged.username;
    const keyboard = {
      inline_keyboard: [[
        {
          text: '🎮 Rejoindre la salle',
          web_app: { url: `${process.env.CLIENT_URL || 'https://skill2cash-yrgx.onrender.com'}/?view=room&id=${duel._id}` }
        }
      ]]
    };

    const result = await sendTelegramMessage(
      challengerCheck.telegramId,
      baseMessage(challenger.efootballUsername, challengedName, challenge.amount, duel.roomId),
      { reply_markup: keyboard }
    );
    results.push({ userId: challenger._id, success: !!result });
  }

  // Notifier le challenged (celui qui a accepté)
  const challengedCheck = await shouldNotifyTelegram(challenged._id);
  if (challengedCheck.shouldNotify) {
    const challengerName = challenger.efootballUsername || challenger.username;
    const keyboard = {
      inline_keyboard: [[
        {
          text: '🎮 Rejoindre la salle',
          web_app: { url: `${process.env.CLIENT_URL || 'https://skill2cash-yrgx.onrender.com'}/?view=room&id=${duel._id}` }
        }
      ]]
    };

    const result = await sendTelegramMessage(
      challengedCheck.telegramId,
      baseMessage(challenged.efootballUsername, challengerName, challenge.amount, duel.roomId),
      { reply_markup: keyboard }
    );
    results.push({ userId: challenged._id, success: !!result });
  }

  console.log(`[TELEGRAM] Challenge accepted notifications:`, results);
  return results;
}

/**
 * ❌ Notification : Défi refusé
 */
export async function notifyChallengeDeclined(challenge, challenger, challenged) {
  const check = await shouldNotifyTelegram(challenge.challenger);
  if (!check.shouldNotify) return null;

  const challengedName = challenged.efootballUsername || challenged.username;
  const message = `❌ <b>DÉFI REFUSÉ</b>

<b>${challengedName}</b> a refusé ton défi de <b>${challenge.amount.toLocaleString('fr-FR')} FCFA</b>.

Ton argent a été recrédité sur ton compte. Tu peux lancer un autre défi !`;

  const keyboard = {
    inline_keyboard: [[
      { text: '⚔️ Lancer un nouveau défi', web_app: { url: `${process.env.CLIENT_URL || 'https://skill2cash-yrgx.onrender.com'}/?view=play` } }
    ]]
  };

  return sendTelegramMessage(check.telegramId, message, { reply_markup: keyboard });
}

/**
 * 📸 Notification : Preuve soumise
 */
export async function notifyProofSubmitted(userId, duel, opponentInfo) {
  const check = await shouldNotifyTelegram(userId);
  if (!check.shouldNotify) return null;

  const opponentName = opponentInfo?.efootballUsername || opponentInfo?.username || 'Adversaire';

  const message = `📸 <b>PREUVE ENVOYÉE</b>

Tu as soumis ta capture de match contre <b>${opponentName}</b>.
🔍 OCR en cours d'analyse...

⏱ Résultat dans quelques secondes.`;

  return sendTelegramMessage(check.telegramId, message);
}

/**
 * 📸 Notification : Preuve reçue (adversaire a soumis)
 */
export async function notifyProofReceived(userId, duel, opponentInfo) {
  const check = await shouldNotifyTelegram(userId);
  if (!check.shouldNotify) return null;

  const opponentName = opponentInfo?.efootballUsername || opponentInfo?.username || 'Adversaire';

  const message = `📸 <b>PREUVE ADVERSAIRE REÇUE</b>

<b>${opponentName}</b> a soumis sa capture de match.
🔍 En attente de ton résultat OCR...

⚠️ Si tu n'as pas encore soumis ta preuve, fais-le rapidement !`;

  const keyboard = {
    inline_keyboard: [[
      {
        text: '📤 Soumettre ma preuve',
        web_app: { url: `${process.env.CLIENT_URL || 'https://skill2cash-yrgx.onrender.com'}/?view=duels&id=${duel._id}` }
      }
    ]]
  };

  return sendTelegramMessage(check.telegramId, message, { reply_markup: keyboard });
}

/**
 * 🔍 Notification : OCR en cours d'analyse
 */
export async function notifyOcrProcessing(userIds, duel) {
  const results = [];

  for (const userId of userIds) {
    const check = await shouldNotifyTelegram(userId);
    if (!check.shouldNotify) continue;

    const message = `🔍 <b>ANALYSE OCR EN COURS</b>

Les captures des deux joueurs sont en cours de vérification par notre système OCR.

⏱ Résultat dans quelques instants...`;

    const result = await sendTelegramMessage(check.telegramId, message);
    results.push({ userId, success: !!result });
  }

  return results;
}

/**
 * 🏆 Notification : Résultat du duel (victoire/défaite)
 */
export async function notifyDuelResult(userId, duel, isWinner, amount, opponentInfo) {
  const check = await shouldNotifyTelegram(userId);
  if (!check.shouldNotify) return null;

  const opponentName = opponentInfo?.efootballUsername || opponentInfo?.username || 'Adversaire';
  const amountFormatted = amount?.toLocaleString('fr-FR') || '0';

  if (isWinner) {
    const message = `🏆 <b>VICTOIRE !</b>

Tu as battu <b>${opponentName}</b> !
💰 Gain : <b>+${amountFormatted} FCFA</b>

🎉 Félicitations ! Continue sur cette lancée !`;

    const keyboard = {
      inline_keyboard: [
        [{ text: '📊 Voir le résultat', web_app: { url: `${process.env.CLIENT_URL || 'https://skill2cash-yrgx.onrender.com'}/?view=duels&id=${duel._id}` } }],
        [{ text: '⚔️ Lancer un nouveau défi', web_app: { url: `${process.env.CLIENT_URL || 'https://skill2cash-yrgx.onrender.com'}/?view=play` } }]
      ]
    };

    return sendTelegramMessage(check.telegramId, message, { reply_markup: keyboard });
  } else {
    const message = `😔 <b>DÉFAITE</b>

Tu as perdu contre <b>${opponentName}</b>.
💸 Perte : <b>-${amountFormatted} FCFA</b>

💪 Relève-toi et venge-toi !`;

    const keyboard = {
      inline_keyboard: [
        [{ text: '🔄 Demander une revanche', web_app: { url: `${process.env.CLIENT_URL || 'https://skill2cash-yrgx.onrender.com'}/?view=challenge&opponent=${encodeURIComponent(opponentName)}` } }],
        [{ text: '⚔️ Nouveau défi', web_app: { url: `${process.env.CLIENT_URL || 'https://skill2cash-yrgx.onrender.com'}/?view=play` } }]
      ]
    };

    return sendTelegramMessage(check.telegramId, message, { reply_markup: keyboard });
  }
}

/**
 * ⚠️ Notification : Litige ouvert
 */
export async function notifyDispute(userIds, duel, reason) {
  const results = [];

  for (const userId of userIds) {
    const check = await shouldNotifyTelegram(userId);
    if (!check.shouldNotify) continue;

    const message = `⚠️ <b>LITIGE OUVERT</b>

Un litige a été ouvert sur votre duel.
📝 Raison : ${reason || 'Résultat contesté'}

👨‍⚖️ Un administrateur va examiner les preuves et prendre une décision.
⏱ Délai : 24-48h maximum.`;

    const keyboard = {
      inline_keyboard: [[
        { text: '🔍 Voir le litige', web_app: { url: `${process.env.CLIENT_URL || 'https://skill2cash-yrgx.onrender.com'}/?view=duels&id=${duel._id}` } }
      ]]
    };

    const result = await sendTelegramMessage(check.telegramId, message, { reply_markup: keyboard });
    results.push({ userId, success: !!result });
  }

  return results;
}

/**
 * 💰 Notification : Transaction wallet
 */
export async function notifyWalletTransaction(userId, type, amount, balance) {
  const check = await shouldNotifyTelegram(userId);
  if (!check.shouldNotify) return null;

  const amountFormatted = amount?.toLocaleString('fr-FR') || '0';
  const balanceFormatted = balance?.toLocaleString('fr-FR') || '0';

  const isDeposit = ['deposit', 'win', 'refund'].includes(type);
  const emoji = isDeposit ? '💰' : '💸';
  const action = isDeposit ? 'reçu' : 'débité';
  const sign = isDeposit ? '+' : '-';

  const typeLabels = {
    deposit: 'Dépôt',
    win: 'Gain de duel',
    refund: 'Remboursement',
    loss: 'Perte de duel',
    withdraw: 'Retrait',
    commission: 'Commission'
  };

  const typeLabel = typeLabels[type] || 'Transaction';

  const message = `${emoji} <b>${typeLabel.toUpperCase()} ${action.toUpperCase()} !</b>

${sign}<b>${amountFormatted} FCFA</b>
💳 Solde actuel : <b>${balanceFormatted} FCFA</b>`;

  const keyboard = {
    inline_keyboard: [[
      { text: '💼 Voir mon wallet', web_app: { url: `${process.env.CLIENT_URL || 'https://skill2cash-yrgx.onrender.com'}/?view=wallet` } }
    ]]
  };

  return sendTelegramMessage(check.telegramId, message, { reply_markup: keyboard });
}

/**
 * ⏰ Notification : Rappel preuve manquante
 */
export async function notifyProofReminder(userId, duel, opponentInfo, timeRemaining) {
  const check = await shouldNotifyTelegram(userId);
  if (!check.shouldNotify) return null;

  const opponentName = opponentInfo?.efootballUsername || opponentInfo?.username || 'Adversaire';

  const message = `⏰ <b>URGENT - PREUVE MANQUANTE</b>

Tu dois soumettre ta preuve contre <b>${opponentName}</b> !
🕐 Temps restant : <b>${timeRemaining}</b>

⚠️ Si tu ne soumets pas de preuve, tu perdras automatiquement le duel ET ta mise !`;

  const keyboard = {
    inline_keyboard: [[
      { text: '📤 Soumettre maintenant', web_app: { url: `${process.env.CLIENT_URL || 'https://skill2cash-yrgx.onrender.com'}/?view=duels&id=${duel._id}` } }
    ]]
  };

  return sendTelegramMessage(check.telegramId, message, { reply_markup: keyboard });
}

/**
 * 🔔 Notification générique
 */
export async function notifyGeneric(userId, title, message, buttons = []) {
  const check = await shouldNotifyTelegram(userId);
  if (!check.shouldNotify) return null;

  const fullMessage = `<b>${title}</b>\n\n${message}`;

  const keyboard = buttons.length > 0 ? { inline_keyboard: [buttons] } : undefined;

  return sendTelegramMessage(check.telegramId, fullMessage, keyboard ? { reply_markup: keyboard } : {});
}

// Export du bot pour accès direct si nécessaire
export { bot };
