/**
 * SKILL2CASH - Bot Telegram Professionnel
 * Gestion complète des défis, duels et notifications
 * Avec handlers callback_query pour Accepter/Refuser depuis Telegram
 * 
 * @author SOLITAIRE HACK
 * @version 2.0.0 - Production Ready
 */

import TelegramBot from 'node-telegram-bot-api';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Challenge } from '../models/Challenge.js';
import { Duel } from '../models/Duel.js';
import { env } from '../config/env.js';
import { acceptChallenge } from '../services/duelService.js';
import { refundStake } from '../services/walletService.js';
import { notifyAdmins } from '../services/notificationService.js';

const botToken = env.telegramBotToken;
let bot = null;

const siteBaseUrl = String(env.clientUrl || 'https://skill2cash-yrgx.onrender.com').replace(/\/$/, '');

export function initTelegramBot() {
  if (!botToken) {
    console.log('⚠️  Telegram bot token not configured - skipping bot initialization');
    return null;
  }

  // Mode webhook ou polling selon l'environnement
  const isProduction = env.nodeEnv === 'production';

  if (isProduction && env.telegramWebhookUrl) {
    // Mode webhook pour production
    bot = new TelegramBot(botToken, { webHook: true });
    bot.setWebHook(`${env.telegramWebhookUrl}/api/telegram/webhook`);
    console.log('🤖 Telegram bot initialized in WEBHOOK mode');
  } else {
    // Mode polling pour développement
    bot = new TelegramBot(botToken, { polling: true });
    console.log('🤖 Telegram bot initialized in POLLING mode');
  }

  setupCommandHandlers();
  setupCallbackHandlers(); // Nouveau: handlers pour boutons inline
  return bot;
}

function setupCommandHandlers() {
  // Commande /start - Message de bienvenue + bouton Mini App
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;

    // Vérifier si l'utilisateur existe déjà
    const existingUser = await User.findOne({ telegramId: chatId });
    const isNewUser = !existingUser;

    const welcomeMessage = isNewUser ? `
🎮 <b>Bienvenue sur SKILL2CASH!</b>

Salut ${username} 👋

<b>🔥 Joue à des duels eFootball & gagne de l'argent!</b>

⚡ <b>Inscription en 1 clic:</b>
Clique sur "🎮 JOUER" ci-dessous → Crée ton compte automatiquement → Commence à jouer !

💰 <b>Mises:</b> De 100 à 50,000 CFA
🏆 <b>Gains:</b> Jusqu'à 2x ta mise
⚡ <b>Instantané:</b> Défis, duels, paiements

� Clique pour commencer 👇
    ` : `
🎮 <b>Bon retour sur SKILL2CASH!</b>

Salut ${username} 👋

<b>💰 Ton solde:</b> ${existingUser?.balanceAvailable || 0} CFA

🔥 Prêt pour un nouveau duel ?
👇 Clique sur "🎮 JOUER" ci-dessous 👇
    `;

    // Bouton Mini App principal
    const miniAppButton = {
      reply_markup: {
        inline_keyboard: [
          [{
            text: isNewUser ? "🎮 JOUER (Inscription auto)" : "🎮 JOUER",
            web_app: { url: `${siteBaseUrl}/telegram-miniapp` }
          }]
        ]
      },
      parse_mode: 'HTML'
    };

    await bot.sendMessage(chatId, welcomeMessage, miniAppButton);
  });

  // Commande /link - Connecter compte avec code
  bot.onText(/\/link (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const linkCode = match[1].trim();

    try {
      // Chercher l'utilisateur avec ce code de liaison
      const user = await User.findOne({ telegramLinkCode: linkCode });

      if (!user) {
        await bot.sendMessage(chatId, `
❌ <b>Code invalide</b>

Ce code n'existe pas ou a expiré.

Va sur skill2cash.com → Paramètres → Notifications pour obtenir un nouveau code.
        `, { parse_mode: 'HTML' });
        return;
      }

      // Lier le compte
      user.telegramId = chatId;
      user.telegramData = {
        id: chatId,
        firstName: msg.from.first_name,
        lastName: msg.from.last_name,
        username: msg.from.username,
        languageCode: msg.from.language_code
      };
      user.telegramLinkCode = null; // Invalider le code
      await user.save();

      // Message de confirmation
      await bot.sendMessage(chatId, `
✅ <b>Compte connecté!</b>

Salut ${user.firstName || user.username} !

Ton compte SKILL2CASH est maintenant lié à Telegram.

<b>🔔 Tu recevras des alertes pour :</b>
• 📨 Nouveaux défis reçus
• ⏰ Duels en attente de validation
• 🏆 Résultats des duels
• 💸 Transactions wallet

<i>Tu peux te déconnecter à tout moment avec /unlink</i>
      `, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🎮 Voir mes duels', url: `${siteBaseUrl}/dashboard?user=${user._id}` }
            ]
          ]
        }
      });

      // Notification au site
      console.log(`[TELEGRAM] User ${user._id} linked to chat ${chatId}`);

    } catch (error) {
      console.error('[TELEGRAM] Link error:', error);
      await bot.sendMessage(chatId, '❌ Une erreur est survenue. Réessaie plus tard.');
    }
  });

  // Commande /unlink - Déconnecter
  bot.onText(/\/unlink/, async (msg) => {
    const chatId = msg.chat.id;

    try {
      const user = await User.findOne({ telegramId: chatId });

      if (!user) {
        await bot.sendMessage(chatId, `
❌ Aucun compte lié.

Utilise /start pour voir comment connecter ton compte.
        `, { parse_mode: 'HTML' });
        return;
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

      await bot.sendMessage(chatId, `
✅ <b>Déconnecté</b>

Ton compte SKILL2CASH n'est plus lié à Telegram.

Tu ne recevras plus de notifications ici.

Pour reconnecter, utilise /start
      `, { parse_mode: 'HTML' });

    } catch (error) {
      console.error('[TELEGRAM] Unlink error:', error);
      await bot.sendMessage(chatId, '❌ Une erreur est survenue.');
    }
  });

  // Commande /help - Aide
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;

    await bot.sendMessage(chatId, `
🤖 <b>Aide du Bot SKILL2CASH</b>

<b>Commandes disponibles :</b>
• /start - Démarrer et voir les instructions
• /link CODE - Connecter ton compte (CODE reçu sur le site)
• /unlink - Déconnecter ton compte
• /help - Cette aide

<b>Comment ça marche ?</b>
1. Connecte-toi sur skill2cash.com
2. Va dans tes paramètres
3. Active les notifications Telegram
4. Copie le code affiché
5. Envoie-moi : /link TON_CODE

<b>Besoin d'aide ?</b>
Contacte le support : support@skill2cash.com
    `, { parse_mode: 'HTML' });
  });

  // Gérer les messages non-commandes
  bot.on('message', async (msg) => {
    // Ignorer les commandes déjà traitées
    if (msg.text && msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;

    await bot.sendMessage(chatId, `
👋 Je suis un bot de notification !

Je ne peux pas discuter, mais je t'enverrai des alertes quand :
• Quelqu'un te défie
• Tes duels sont validés
• Tu gagnes de l'argent

Utilise /help pour voir les commandes disponibles.
    `, { parse_mode: 'HTML' });
  });

  // Gérer les erreurs
  bot.on('error', (error) => {
    console.error('[TELEGRAM BOT] Error:', error);
  });

  bot.on('polling_error', (error) => {
    console.error('[TELEGRAM BOT] Polling error:', error);
  });
}

/**
 * Handlers pour les boutons callback (Accepter/Refuser)
 * Permet d'accepter/refuser un défi directement depuis Telegram
 */
function setupCallbackHandlers() {
  // Handler pour les callback queries
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    try {
      // Acknowledge the callback immediately
      await bot.answerCallbackQuery(query.id);

      // Parser le callback_data
      // Format: action:resourceId
      const [action, resourceId] = data.split(':');

      switch (action) {
        case 'challenge_accept':
          await handleChallengeAccept(chatId, messageId, resourceId, query.from);
          break;

        case 'challenge_decline':
          await handleChallengeDecline(chatId, messageId, resourceId, query.from);
          break;

        case 'duel_open':
          await handleDuelOpen(chatId, resourceId);
          break;

        default:
          console.log(`[TELEGRAM] Unknown callback action: ${action}`);
      }
    } catch (error) {
      console.error('[TELEGRAM CALLBACK ERROR]', error);
      await bot.sendMessage(chatId, '❌ Une erreur est survenue. Réessaie depuis le site.');
    }
  });
}

/**
 * Handler: Accepter un défi depuis Telegram
 */
async function handleChallengeAccept(chatId, messageId, challengeId, from) {
  console.log(`[TELEGRAM] Accept challenge ${challengeId} from chat ${chatId}`);

  try {
    // Trouver l'utilisateur par telegramId
    const user = await User.findOne({ telegramId: chatId });
    if (!user) {
      await bot.sendMessage(chatId, '❌ Compte non lié. Connecte-toi d\'abord sur le site.');
      return;
    }

    // Vérifier que le défi existe et est destiné à cet utilisateur
    const challenge = await Challenge.findById(challengeId);
    if (!challenge) {
      await bot.sendMessage(chatId, '❌ Ce défi n\'existe plus.');
      return;
    }

    if (String(challenge.challenged) !== String(user._id)) {
      await bot.sendMessage(chatId, '❌ Ce défi ne t\'est pas destiné.');
      return;
    }

    if (challenge.status !== 'pending' && challenge.status !== 'counter_offer') {
      await bot.sendMessage(chatId, '⚠️ Ce défi a déjà été traité.');
      return;
    }

    // Accepter le défi via le service existant
    const duel = await acceptChallenge(challengeId, user._id);

    // Mettre à jour le message original
    await bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      { chat_id: chatId, message_id: messageId }
    );

    // Envoyer confirmation
    const challenger = await User.findById(challenge.challenger);
    const challengerName = challenger?.efootballUsername || challenger?.username || 'Adversaire';

    await bot.sendMessage(chatId, `✅ <b>DÉFI ACCEPTÉ !</b>

Tu as accepté le défi de <b>${challengerName}</b>
💰 Mise: <b>${challenge.amount.toLocaleString('fr-FR')} FCFA</b>
🏟 Salle: <code>${duel.roomId}</code>

🎮 La salle est prête ! Clique ci-dessous pour rejoindre :`, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: '🎮 REJOINDRE LA SALLE', web_app: { url: `${siteBaseUrl}/?view=room&id=${duel._id}` } }
        ]]
      }
    });

    // Notifier le challenger
    if (challenger?.telegramId) {
      await bot.sendMessage(challenger.telegramId, `🎉 <b>Ton défi a été accepté !</b>

<b>${user.efootballUsername || user.username}</b> a accepté ton défi
💰 Mise: <b>${challenge.amount.toLocaleString('fr-FR')} FCFA</b>
🏟 Salle: <code>${duel.roomId}</code>

⚔️ Le match peut commencer !`, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '🎮 REJOINDRE LA SALLE', web_app: { url: `${siteBaseUrl}/?view=room&id=${duel._id}` } }
          ]]
        }
      });
    }

    console.log(`[TELEGRAM] Challenge ${challengeId} accepted by user ${user._id}, duel ${duel._id} created`);

  } catch (error) {
    console.error('[TELEGRAM ACCEPT ERROR]', error);
    const errorMsg = error.message || 'Erreur lors de l\'acceptation';
    await bot.sendMessage(chatId, `❌ <b>Erreur</b>: ${errorMsg}\n\nRéessaie depuis le site: ${siteBaseUrl}`, { parse_mode: 'HTML' });
  }
}

/**
 * Handler: Refuser un défi depuis Telegram
 */
async function handleChallengeDecline(chatId, messageId, challengeId, from) {
  console.log(`[TELEGRAM] Decline challenge ${challengeId} from chat ${chatId}`);

  try {
    // Trouver l'utilisateur
    const user = await User.findOne({ telegramId: chatId });
    if (!user) {
      await bot.sendMessage(chatId, '❌ Compte non lié. Connecte-toi d\'abord sur le site.');
      return;
    }

    // Vérifier le défi
    const challenge = await Challenge.findById(challengeId);
    if (!challenge) {
      await bot.sendMessage(chatId, '❌ Ce défi n\'existe plus.');
      return;
    }

    if (String(challenge.challenged) !== String(user._id)) {
      await bot.sendMessage(chatId, '❌ Ce défi ne t\'est pas destiné.');
      return;
    }

    if (!['pending', 'counter_offer'].includes(challenge.status)) {
      await bot.sendMessage(chatId, '⚠️ Ce défi a déjà été traité.');
      return;
    }

    // Refuser le défi
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // Rembourser la mise bloquée
        if (Number(challenge.reservedAmount || 0) > 0) {
          await refundStake(challenge.challenger, challenge.reservedAmount, challenge._id, session);
        }

        challenge.status = 'declined';
        await challenge.save({ session });
      });
    } finally {
      await session.endSession();
    }

    // Mettre à jour le message original
    await bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      { chat_id: chatId, message_id: messageId }
    );

    // Confirmation
    await bot.sendMessage(chatId, `❌ <b>DÉFI REFUSÉ</b>

Tu as refusé le défi.
L'argent du challenger a été recrédité.`, { parse_mode: 'HTML' });

    // Notifier le challenger
    const challenger = await User.findById(challenge.challenger);
    if (challenger?.telegramId) {
      const userName = user.efootballUsername || user.username;
      await bot.sendMessage(challenger.telegramId, `😔 <b>Défi refusé</b>

<b>${userName}</b> a refusé ton défi de <b>${challenge.amount.toLocaleString('fr-FR')} FCFA</b>.

💰 Ton argent a été recrédité.`, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '⚔️ Lancer un nouveau défi', web_app: { url: `${siteBaseUrl}/?view=play` } }
          ]]
        }
      });
    }

    // Notification admin
    await notifyAdmins('admin:challenge_declined', {
      challengeId: challenge._id,
      challengerId: challenge.challenger,
      challengedId: user._id,
      amount: challenge.amount
    });

    console.log(`[TELEGRAM] Challenge ${challengeId} declined by user ${user._id}`);

  } catch (error) {
    console.error('[TELEGRAM DECLINE ERROR]', error);
    await bot.sendMessage(chatId, '❌ Erreur lors du refus. Réessaie depuis le site.');
  }
}

/**
 * Handler: Ouvrir un duel (redirection)
 */
async function handleDuelOpen(chatId, duelId) {
  await bot.sendMessage(chatId, '🎮 <b>Ouvrir le duel</b>\n\nClique ci-dessous :', {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '🎮 OUVRIR LA SALLE', web_app: { url: `${siteBaseUrl}/?view=room&id=${duelId}` } }
      ]]
    }
  });
}

// Fonction pour envoyer notification de défi
export async function notifyChallengeReceived(telegramId, challengerName, stakeAmount, duelId) {
  if (!bot) return;

  const message = `
🎯 <b>Nouveau défi reçu!</b>

👤 <b>${challengerName}</b> vient de t'envoyer un défi !

💰 Mise : <b>${stakeAmount.toLocaleString()} FCFA</b>

⏰ Accepte rapidement avant qu'il ne change d'avis !
  `;

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: '⚔️ Voir le défi',
          url: `${siteBaseUrl}/duels/${duelId}`
        }
      ],
      [
        {
          text: '🌐 Aller sur le site',
          url: `${siteBaseUrl}/dashboard`
        }
      ]
    ]
  };

  try {
    await bot.sendMessage(telegramId, message, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  } catch (error) {
    console.error('[TELEGRAM] Failed to send challenge notification:', error);
  }
}

// Fonction pour notifier victoire
export async function notifyDuelWon(telegramId, opponentName, amount, duelId) {
  if (!bot) return;

  const message = `
🏆 <b>VICTOIRE!</b>

Tu as battu <b>${opponentName}</b> !

💰 Gain : <b>+${amount.toLocaleString()} FCFA</b>

🎉 Continue comme ça !
  `;

  try {
    await bot.sendMessage(telegramId, message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '📊 Voir le résultat',
              url: `${siteBaseUrl}/duels/${duelId}`
            }
          ]
        ]
      }
    });
  } catch (error) {
    console.error('[TELEGRAM] Failed to send win notification:', error);
  }
}

// Fonction pour notifier défaite
export async function notifyDuelLost(telegramId, opponentName, amount, duelId) {
  if (!bot) return;

  const message = `
😔 <b>Défaite</b>

Tu as perdu contre <b>${opponentName}</b>.

💸 Perte : <b>-${amount.toLocaleString()} FCFA</b>

💪 Relève-toi et venge-toi !
  `;

  try {
    await bot.sendMessage(telegramId, message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '🔄 Lancer un revanche',
              url: `${siteBaseUrl}/challenge?opponent=${encodeURIComponent(opponentName)}`
            }
          ]
        ]
      }
    });
  } catch (error) {
    console.error('[TELEGRAM] Failed to send loss notification:', error);
  }
}

// Fonction pour notifier duel en attente de preuve
export async function notifyProofRequired(telegramId, opponentName, timeRemaining, duelId) {
  if (!bot) return;

  const message = `
⏰ <b>Duel en attente!</b>

Tu dois soumettre ta preuve contre <b>${opponentName}</b>.

🕐 Temps restant : <b>${timeRemaining}</b>

⚠️ Si tu ne soumets pas de preuve, tu perdras automatiquement !
  `;

  try {
    await bot.sendMessage(telegramId, message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '📤 Soumettre ma preuve',
              url: `${siteBaseUrl}/duels/${duelId}`
            }
          ]
        ]
      }
    });
  } catch (error) {
    console.error('[TELEGRAM] Failed to send proof required notification:', error);
  }
}

// Fonction pour notifier transaction wallet
export async function notifyWalletTransaction(telegramId, type, amount, balance) {
  if (!bot) return;

  const isDeposit = type === 'deposit' || type === 'win';
  const emoji = isDeposit ? '💰' : '💸';
  const action = isDeposit ? 'reçu' : 'envoyé';
  const sign = isDeposit ? '+' : '-';

  const message = `
${emoji} <b>Transaction ${action}!</b>

${sign}<b>${amount.toLocaleString()} FCFA</b>

💳 Solde actuel : <b>${balance.toLocaleString()} FCFA</b>
  `;

  try {
    await bot.sendMessage(telegramId, message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '💼 Voir mon wallet',
              url: `${siteBaseUrl}/wallet`
            }
          ]
        ]
      }
    });
  } catch (error) {
    console.error('[TELEGRAM] Failed to send wallet notification:', error);
  }
}

export { bot };
