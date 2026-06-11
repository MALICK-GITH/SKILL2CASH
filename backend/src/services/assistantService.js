import { env } from '../config/env.js';
import mongoose from 'mongoose';
import { AdminLog } from '../models/AdminLog.js';
import { Arbitration } from '../models/Arbitration.js';
import { Challenge } from '../models/Challenge.js';
import { CommissionSetting } from '../models/CommissionSetting.js';
import { Deposit } from '../models/Deposit.js';
import { Duel } from '../models/Duel.js';
import { Game } from '../models/Game.js';
import { GameProfile } from '../models/GameProfile.js';
import { ChatMessage } from '../models/ChatMessage.js';
import { Notification } from '../models/Notification.js';
import { Platform } from '../models/Platform.js';
import { PublicInvitation } from '../models/PublicInvitation.js';
import { Room } from '../models/Room.js';
import { Session } from '../models/Session.js';
import { Stream } from '../models/Stream.js';
import { Transaction } from '../models/Transaction.js';
import { User } from '../models/User.js';
import { Wallet } from '../models/Wallet.js';
import { Withdrawal } from '../models/Withdrawal.js';
import { UsernameChangeRequest } from '../models/UsernameChangeRequest.js';
import { AppError } from '../utils/AppError.js';
import { cancelOpenChallenges } from './adminChallengeService.js';
import { buildTrustProfile } from './trustService.js';
import { approveManualDeposit, rejectManualDeposit } from './depositService.js';
import { cancelDuel, finishDuel } from './duelService.js';
import { adjustBalance } from './walletService.js';

const MAX_HISTORY_MESSAGES = 10;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_LIST_ITEMS = 5;
const OFFICIAL_ADMIN_CONFIRM_TOKEN = 'CONFIRM_ADMIN_ACTION';

function requireValidObjectId(value, fieldName) {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new AppError(`${fieldName} invalide`, 422);
  }
}

function isCriticalOfficialAction(type) {
  return new Set([
    'approve_deposit',
    'reject_deposit',
    'approve_withdrawal',
    'reject_withdrawal',
    'resolve_dispute_winner',
    'resolve_dispute_cancel',
    'ban_user',
    'adjust_balance'
  ]).has(type);
}

function resolveAdminActionTargetId(type, adminAction, user) {
  const valueByType = {
    approve_deposit: adminAction?.depositId,
    reject_deposit: adminAction?.depositId,
    approve_withdrawal: adminAction?.withdrawalId,
    reject_withdrawal: adminAction?.withdrawalId,
    resolve_dispute_winner: adminAction?.duelId,
    resolve_dispute_cancel: adminAction?.duelId,
    ban_user: adminAction?.userId,
    adjust_balance: adminAction?.userId
  };
  const candidate = valueByType[type] || adminAction?.targetId || adminAction?.id || user?._id;
  if (mongoose.Types.ObjectId.isValid(candidate)) {
    return new mongoose.Types.ObjectId(candidate);
  }
  return mongoose.Types.ObjectId.isValid(user?._id) ? new mongoose.Types.ObjectId(user._id) : null;
}

function trimText(value, maxLength = MAX_MESSAGE_LENGTH) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMessages(messages = []) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter((message) => message && typeof message === 'object')
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: message.role,
      content: trimText(message.content, MAX_MESSAGE_LENGTH)
    }))
    .filter((message) => message.content)
    .slice(-MAX_HISTORY_MESSAGES);
}

function resolveProviderUrl(baseUrl, path) {
  const normalizedBase = String(baseUrl || '').replace(/\/+$/, '');
  return normalizedBase.endsWith(path) ? normalizedBase : `${normalizedBase}${path}`;
}

function looksLikeAnthropicBaseUrl(baseUrl) {
  try {
    return new URL(baseUrl).hostname.includes('anthropic.com');
  } catch {
    return false;
  }
}

function resolveAuthHeaders(baseUrl) {
  const token = env.aiToken;
  if (!token) return {};
  if (looksLikeAnthropicBaseUrl(baseUrl)) {
    return { 'x-api-key': token };
  }
  return { authorization: `Bearer ${token}` };
}

function extractAnthropicText(payload) {
  if (!payload || !Array.isArray(payload.content)) return '';
  return payload.content
    .map((block) => (block && block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractOpenAIText(payload) {
  const choice = payload?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((block) => (typeof block?.text === 'string' ? block.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

function formatNumber(value) {
  return new Intl.NumberFormat('fr-FR').format(Number(value || 0));
}

function formatCurrency(value) {
  return `${formatNumber(value)} CFA`;
}

function formatDateTime(value) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return date.toLocaleString('fr-FR');
}

function formatDate(value) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return date.toLocaleDateString('fr-FR');
}

function formatName(entity, fallback = 'n/a') {
  if (!entity) return fallback;
  return entity.name || entity.username || entity.title || entity.channelName || entity.gamertag || fallback;
}

function summarizeUser(user) {
  if (!user) return null;
  return {
    id: String(user._id),
    username: user.username,
    role: user.role,
    country: user.country,
    level: user.level,
    status: user.status,
    rank: user.rank,
    badge: user.badge,
    wins: user.wins,
    losses: user.losses,
    currentStreak: user.currentStreak,
    totalEarnings: user.totalEarnings,
    reputation: user.reputation,
    reportsCount: user.reportsCount
  };
}

function getAssistantDisplayName(user) {
  if (!user) return 'Joueur';
  const fullName = `${String(user.firstName || '').trim()} ${String(user.lastName || '').trim()}`.trim();
  if (fullName) return fullName;
  return user.efootballUsername || user.username || 'Joueur';
}

function greetingForHour(hour) {
  if (hour >= 5 && hour < 12) return 'Bonjour';
  if (hour >= 12 && hour < 18) return 'Bon après-midi';
  if (hour >= 18 && hour < 23) return 'Bonsoir';
  return 'Salut';
}

function isGreetingPrompt(prompt) {
  const text = normalizeText(prompt);
  if (!text) return false;
  const match = text.match(/^(salut|bonjour|bonsoir|hello|hi|hey|coucou)(?:[!.,]*)\s*(.*)$/);
  if (!match) return false;
  const rest = String(match[2] || '').trim();
  if (!rest) return true;
  return /^[a-zà-ÿ'-]{1,24}$/i.test(rest);
}

function buildGreetingReply({ user }) {
  const displayName = getAssistantDisplayName(user);
  const roleLine = user?.role === 'admin'
    ? 'Je suis dans ton périmètre admin: je peux te parler des litiges, dépôts, retraits, duels, joueurs et actions d équipe autorisées.'
    : 'Je reste sur tes infos et sur ce qu’un joueur peut voir ou faire sur la plateforme.';

  return {
    reply: user ? `Salut ${displayName}.\n${roleLine}` : 'Salut.\nJe suis là pour t aider sur SKILL2CASH.',
    provider: 'local-greeting',
    model: 'local'
  };
}

function buildTimeGreetingReply({ user }) {
  const greeting = greetingForHour(new Date().getHours());
  const displayName = getAssistantDisplayName(user);
  if (!user) {
    return {
      reply: `${greeting}.\nJe suis là pour t aider sur SKILL2CASH.`,
      provider: 'local-greeting',
      model: 'local'
    };
  }

  const roleLine = user.role === 'admin'
    ? 'Je suis dans ton périmètre admin: je peux te parler des litiges, dépôts, retraits, duels, joueurs et actions d équipe autorisées.'
    : 'Je reste sur tes infos et sur ce qu’un joueur peut voir ou faire sur la plateforme.';

  return {
    reply: `${greeting} ${displayName}.\n${roleLine}`,
    provider: 'local-greeting',
    model: 'local'
  };
}

function buildAssistantSuggestions({ user, view, prompt }) {
  const normalized = normalizeText(prompt);
  const isAdmin = user?.role === 'admin';

  if (/ocr|preuve|capture/.test(normalized)) {
    return isAdmin
      ? ['Dépôts OCR à vérifier', 'Litiges en attente', 'Résumé OCR admin', 'Voir les preuves']
      : ['Comment déposer ?', 'Préparer une preuve', 'Comprendre l OCR', 'Voir mes dépôts'];
  }

  if (/solde|wallet|portefeuille|retrait/.test(normalized)) {
    return isAdmin
      ? ['Retraits à traiter', 'Voir les utilisateurs', 'Résumé retraits', 'Ajuster un solde']
      : ['Où voir mon solde ?', 'Comment retirer ?', 'Mes retraits', 'Comment déposer ?'];
  }

  if (/duel|match|defi|challenge/.test(normalized) || view === 'play' || view === 'room') {
    return isAdmin
      ? ['Litiges en attente', 'Duel OCR expliqué', 'Derniers duels', 'Salles actives']
      : ['Comment jouer ?', 'Trouver un adversaire', 'Mes derniers duels', 'Comprendre l OCR'];
  }

  if (view === 'deposit') {
    return isAdmin
      ? ['Dépôts OCR à vérifier', 'Comment valider un dépôt ?', 'Voir les preuves', 'Résumé dépôts']
      : ['Comment déposer ?', 'OCR dépôt expliqué', 'Que mettre en référence ?', 'Voir mes dépôts'];
  }

  if (view === 'withdraw') {
    return isAdmin
      ? ['Retraits à traiter', 'Comment valider un retrait ?', 'Utilisateurs à risque', 'Résumé retraits']
      : ['Comment retirer ?', 'Quel numéro utiliser ?', 'Mes retraits', 'Voir mon solde'];
  }

  if (view === 'admin') {
    return [
      'Litiges en attente',
      'Dépôts OCR à vérifier',
      'Retraits à traiter',
      'Voir les utilisateurs',
      'Résumé admin du jour'
    ];
  }

  if (view === 'landing' || view === 'auth') {
    return [
      'Créer un compte',
      'Comment déposer ?',
      'Comment jouer ?',
      'Comment retirer ?',
      'Comprendre l OCR'
    ];
  }

  return isAdmin
    ? ['Résumé admin du jour', 'Litiges en attente', 'Dépôts OCR à vérifier', 'Retraits à traiter']
    : ['Comment déposer ?', 'Comment jouer ?', 'Où voir mon solde ?', 'Mes derniers duels'];
}

function enrichAssistantResponse(response, { user, view, prompt }) {
  if (!response || typeof response !== 'object') return response;
  if (response.suggestions && Array.isArray(response.suggestions) && response.suggestions.length) return response;
  return {
    ...response,
    suggestions: buildAssistantSuggestions({ user, view, prompt })
  };
}

function formatRecentChallenge(challenge) {
  return [
    `${formatName(challenge.challenger, 'Challenger')} -> ${formatName(challenge.challenged, 'Challenged')}`,
    `montant=${formatCurrency(challenge.amount)}`,
    `status=${challenge.status}`,
    `room=${challenge.roomId || 'n/a'}`,
    `expire=${formatDateTime(challenge.expiresAt)}`
  ].join(' | ');
}

function formatRecentDuel(duel) {
  return [
    `${formatName(duel.player1, 'Player 1')} vs ${formatName(duel.player2, 'Player 2')}`,
    `mise=${formatCurrency(duel.amount)}`,
    `status=${duel.status}`,
    `winner=${formatName(duel.winner, 'n/a')}`,
    `finished=${formatDateTime(duel.finishedAt)}`
  ].join(' | ');
}

function formatPublicInvitation(invitation) {
  return [
    `host=${formatName(invitation.host, 'n/a')}`,
    `mode=${invitation.mode || '1v1'}`,
    `status=${invitation.status}`,
    `room=${invitation.room?.name || invitation.roomId || 'n/a'}`,
    `expire=${formatDateTime(invitation.expiresAt)}`
  ].join(' | ');
}

function formatDeposit(deposit) {
  return [
    `user=${formatName(deposit.user, 'n/a')}`,
    `method=${deposit.method}`,
    `amount=${formatCurrency(deposit.amount)}`,
    `status=${deposit.status}`,
    `ocr=${deposit.autoVerificationStatus}`
  ].join(' | ');
}

function formatWithdrawal(withdrawal) {
  return [
    `user=${formatName(withdrawal.user, 'n/a')}`,
    `method=${withdrawal.method}`,
    `amount=${formatCurrency(withdrawal.amount)}`,
    `status=${withdrawal.status}`,
    `net=${formatCurrency(withdrawal.netAmount)}`
  ].join(' | ');
}

function formatRoom(room) {
  return [
    `${room.name}`,
    `bet=${formatCurrency(room.betAmount)}`,
    `multiplier=${room.winMultiplier}`,
    `fee=${room.platformFee}`,
    `active=${room.isActive ? 'yes' : 'no'}`
  ].join(' | ');
}

function formatProfile(profile) {
  return [
    `user=${formatName(profile.user, 'n/a')}`,
    `game=${formatName(profile.game, 'n/a')}`,
    `platform=${formatName(profile.platform, 'n/a')}`,
    `gamertag=${profile.gamertag || 'n/a'}`,
    `rank=${profile.rank || 'n/a'}`,
    `primary=${profile.isPrimary ? 'yes' : 'no'}`
  ].join(' | ');
}

function formatAdminLog(entry) {
  return [
    `action=${entry.action || 'n/a'}`,
    `targetType=${entry.targetType || 'n/a'}`,
    `targetId=${entry.targetId || 'n/a'}`,
    `note=${entry.note || ''}`,
    `date=${formatDateTime(entry.createdAt)}`
  ].join(' | ');
}

function blockFromList(title, values) {
  if (!values || !values.length) {
    return [`${title}:`, '- aucun'];
  }

  return [`${title}:`, ...values.map((value) => `- ${value}`)];
}

function buildSystemPrompt({ user, view, context }) {
  const isAdmin = user?.role === 'admin';
  const baseRules = [
    'Tu es l assistant officiel global de SKILL2CASH.',
    `Role de l assistant: ${env.aiAssistantRole === 'admin' ? 'administrateur systeme' : 'operateur'}.`,
    'Reponds en francais, avec des phrases courtes, claires et precises.',
    'Tu connais le site, ses pages, ses regles, ses flux et ses donnees autorisees.',
    'Tu peux utiliser le contexte transmis pour repondre sur les comptes, les duels, le wallet, les depots, les retraits, les litiges, les salles, les invitations, les profils de jeu, les commissions et l administration.',
    'Tu peux analyser l etat OCR, expliquer ses resultats, repérer les preuves douteuses et proposer des actions de revue admin.',
    'Quand on te demande comment fonctionne OCR, explique le pipeline complet: capture, extraction du texte, comparaison des montants, des references et des noms, puis validation automatique ou revue manuelle.',
    'Quand on te demande comment fonctionnent les matchs, explique le pipeline complet: creation du defi, verrouillage des fonds, ouverture de la salle, envoi des preuves, comparaison OCR, verdict, litige ou paiement.',
    'Quand on te demande depots ou retraits, explique le pipeline complet: soumission, OCR, statut en attente, validation ou rejet, puis mise a jour du wallet et notification.',
    'Tu ne dois jamais inventer un solde, un score, un statut ou une action non verifiee.',
    'Si une donnee manque, dis-le franchement et propose la bonne page ou la bonne action.',
    isAdmin
      ? 'L utilisateur est administrateur authentifie: tu peux parler des donnees internes admin visibles dans le contexte, mais tu ne dois jamais pretendre avoir execute une action sans appel explicite a une fonction ou a une route admin.'
      : 'L utilisateur est un joueur: ne parle que de ses propres donnees et des informations publiques du site. Si on demande des donnees, operations ou actions d un autre compte, refuse poliment.',
    'Ne divulgue jamais le solde, les operations ou les informations privees d un autre client sauf si la requete vient d un administrateur authentifie.',
    'Quand c est utile, donne une reponse en etapes numerotees tres courtes.'
  ];

  const userBlock = user
    ? [
      `Utilisateur connecte: ${user.username} (${user.role}).`,
      `Contexte compte: pays=${user.country}, niveau=${user.level}, statut=${user.status}, rang=${user.rank}, badge=${user.badge}.`,
      `Performance: wins=${user.wins}, losses=${user.losses}, streak=${user.currentStreak}, earnings=${user.totalEarnings}, reputation=${user.reputation}, reports=${user.reportsCount}.`,
      `Confiance: ${JSON.stringify(buildTrustProfile(user)).replaceAll('\n', ' ')}`
    ]
    : ['Utilisateur non connecte. Reponds uniquement avec les informations publiques du site.'];

  return [...baseRules, `Vue actuelle: ${view || 'global'}.`, ...userBlock, context].join('\n');
}

async function resolveOptionalUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;

  try {
    const { default: jwt } = await import('jsonwebtoken');
    const { env: runtimeEnv } = await import('../config/env.js');
    const decoded = jwt.verify(token, runtimeEnv.jwtSecret);
    return await User.findById(decoded.id).select('-passwordHash');
  } catch {
    return null;
  }
}

async function fetchGlobalSnapshot() {
  const [
    totalUsers,
    totalAdmins,
    totalBannedUsers,
    totalWallets,
    totalBalanceAvailable,
    totalBalanceLocked,
    totalDeposited,
    totalWithdrawn,
    activeChallenges,
    openChallenges,
    activeDuels,
    disputes,
    pendingDeposits,
    pendingWithdrawals,
    pendingArbitrations,
    pendingUsernameChanges,
    openInvitations,
    liveStreams,
    activeRooms,
    activeGames,
    activePlatforms,
    activeCommissionSettings,
    totalProfiles,
    unreadNotifications,
    duelOcrAutoApproved,
    duelOcrManualReview,
    duelOcrFailed,
    depositOcrMatched,
    depositOcrNeedsReview,
    depositOcrFailed,
    depositOcrPending
  ] = await Promise.all([
    User.countDocuments({ deletedAt: null }),
    User.countDocuments({ role: 'admin', deletedAt: null }),
    User.countDocuments({ isBanned: true, deletedAt: null }),
    Wallet.countDocuments({ deletedAt: null }),
    Wallet.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: null, total: { $sum: '$balanceAvailable' } } }]),
    Wallet.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: null, total: { $sum: '$balanceLocked' } } }]),
    Wallet.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: null, total: { $sum: '$totalDeposited' } } }]),
    Wallet.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: null, total: { $sum: '$totalWithdrawn' } } }]),
    Challenge.countDocuments({ status: { $in: ['accepted', 'in_progress', 'completed'] } }),
    Challenge.countDocuments({ status: { $in: ['pending', 'counter_offer'] } }),
    Duel.countDocuments({ status: { $in: ['active', 'waiting_player1_proof', 'waiting_player2_proof', 'waiting_result', 'analyzing', 'under_review'] } }),
    Duel.countDocuments({ status: 'dispute' }),
    Deposit.countDocuments({ status: 'pending' }),
    Withdrawal.countDocuments({ status: 'pending' }),
    Arbitration.countDocuments({ status: { $in: ['pending', 'in_review'] } }),
    UsernameChangeRequest.countDocuments({ status: 'pending' }),
    PublicInvitation.countDocuments({ status: 'open' }),
    Stream.countDocuments({ status: 'live' }),
    Room.countDocuments({ isActive: true }),
    Game.countDocuments({ isActive: true }),
    Platform.countDocuments({ isActive: true }),
    CommissionSetting.countDocuments({ active: true }),
    GameProfile.countDocuments({}),
    Notification.countDocuments({ isRead: false }),
    Duel.countDocuments({ autoValidationStatus: 'auto_approved' }),
    Duel.countDocuments({ autoValidationStatus: 'manual_review' }),
    Duel.countDocuments({ autoValidationStatus: 'failed' }),
    Deposit.countDocuments({ autoVerificationStatus: 'matched' }),
    Deposit.countDocuments({ autoVerificationStatus: 'needs_review' }),
    Deposit.countDocuments({ autoVerificationStatus: 'failed' }),
    Deposit.countDocuments({ autoVerificationStatus: 'pending' })
  ]);

  const [recentRooms, recentInvitations, recentDuels, recentChallenges, recentProfiles, recentPendingDeposits, recentPendingWithdrawals] = await Promise.all([
    Room.find({ isActive: true }).sort({ isFeatured: -1, updatedAt: -1 }).limit(MAX_LIST_ITEMS).populate('game platform', 'name slug').lean(),
    PublicInvitation.find({ status: 'open' })
      .sort({ createdAt: -1 })
      .limit(MAX_LIST_ITEMS)
      .populate('host', 'username country rank')
      .populate('room', 'name betAmount')
      .lean(),
    Duel.find({ status: { $in: ['active', 'waiting_player1_proof', 'waiting_player2_proof', 'waiting_result', 'analyzing', 'under_review', 'dispute'] } })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(MAX_LIST_ITEMS)
      .populate('player1 player2 winner', 'username country rank')
      .lean(),
    Challenge.find({ status: { $in: ['pending', 'counter_offer', 'accepted', 'in_progress'] } })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(MAX_LIST_ITEMS)
      .populate('challenger challenged', 'username country rank')
      .lean(),
    GameProfile.find({})
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(MAX_LIST_ITEMS)
      .populate('user game platform', 'username name slug')
      .lean(),
    Deposit.find({ status: 'pending' })
      .sort({ createdAt: -1 })
      .limit(MAX_LIST_ITEMS)
      .populate('user', 'username country rank')
      .lean(),
    Withdrawal.find({ status: 'pending' })
      .sort({ createdAt: -1 })
      .limit(MAX_LIST_ITEMS)
      .populate('user', 'username country rank')
      .lean()
  ]);

  return {
    totals: {
      users: totalUsers,
      admins: totalAdmins,
      bannedUsers: totalBannedUsers,
      wallets: totalWallets,
      balanceAvailable: totalBalanceAvailable[0]?.total || 0,
      balanceLocked: totalBalanceLocked[0]?.total || 0,
      totalDeposited: totalDeposited[0]?.total || 0,
      totalWithdrawn: totalWithdrawn[0]?.total || 0,
      activeChallenges,
      openChallenges,
      activeDuels,
      disputes,
      pendingDeposits,
      pendingWithdrawals,
      pendingArbitrations,
      pendingUsernameChanges,
      openInvitations,
      liveStreams,
      activeRooms,
      activeGames,
      activePlatforms,
      activeCommissionSettings,
      totalProfiles,
      unreadNotifications,
      duelOcrAutoApproved,
      duelOcrManualReview,
      duelOcrFailed,
      depositOcrMatched,
      depositOcrNeedsReview,
      depositOcrFailed,
      depositOcrPending
    },
    recentRooms,
    recentInvitations,
    recentDuels,
    recentChallenges,
    recentProfiles,
    recentPendingDeposits,
    recentPendingWithdrawals
  };
}

function buildPublicBlocks(snapshot) {
  const blocks = [
    'Fonctionnement du site:',
    '- Defis: un joueur defie un autre avec une mise autorisee par son solde disponible.',
    '- Duels: le resultat est soumis par les joueurs, analyse, puis traite automatiquement ou en litige.',
    '- Portefeuille: depots, retraits, mises bloquees et remboursements sont separes.',
    '- Classement: gains, victoires, taux de victoire et fiabilite sont visibles.',
    '- Communaute: le lien officiel public est WhatsApp, pas Discord.'
  ];

  if (!snapshot) return blocks;

  return [
    ...blocks,
    'Vue globale du site:',
    `- Utilisateurs: ${formatNumber(snapshot.totals.users)}`,
    `- Administrateurs: ${formatNumber(snapshot.totals.admins)}`,
    `- Comptes bannis: ${formatNumber(snapshot.totals.bannedUsers)}`,
    `- Wallets: ${formatNumber(snapshot.totals.wallets)}`,
    `- Solde disponible total: ${formatCurrency(snapshot.totals.balanceAvailable)}`,
    `- Solde bloque total: ${formatCurrency(snapshot.totals.balanceLocked)}`,
    `- Total depose: ${formatCurrency(snapshot.totals.totalDeposited)}`,
    `- Total retire: ${formatCurrency(snapshot.totals.totalWithdrawn)}`,
    `- Defis ouverts: ${formatNumber(snapshot.totals.openChallenges)}`,
    `- Defis en cours: ${formatNumber(snapshot.totals.activeChallenges)}`,
    `- Duels actifs ou en review: ${formatNumber(snapshot.totals.activeDuels)}`,
    `- Litiges: ${formatNumber(snapshot.totals.disputes)}`,
    `- Depots en attente: ${formatNumber(snapshot.totals.pendingDeposits)}`,
    `- Retraits en attente: ${formatNumber(snapshot.totals.pendingWithdrawals)}`,
    `- Arbitrages en attente: ${formatNumber(snapshot.totals.pendingArbitrations)}`,
    `- Changements de pseudo en attente: ${formatNumber(snapshot.totals.pendingUsernameChanges)}`,
    `- Invitations publiques ouvertes: ${formatNumber(snapshot.totals.openInvitations)}`,
    `- Streams live: ${formatNumber(snapshot.totals.liveStreams)}`,
    `- Salles actives: ${formatNumber(snapshot.totals.activeRooms)}`,
    `- Jeux actifs: ${formatNumber(snapshot.totals.activeGames)}`,
    `- Plateformes actives: ${formatNumber(snapshot.totals.activePlatforms)}`,
    `- Regles de commission actives: ${formatNumber(snapshot.totals.activeCommissionSettings)}`,
    `- Profils de jeu: ${formatNumber(snapshot.totals.totalProfiles)}`,
    `- Notifications non lues: ${formatNumber(snapshot.totals.unreadNotifications)}`,
    'OCR global:',
    `- Duels OCR auto-valides: ${formatNumber(snapshot.totals.duelOcrAutoApproved)}`,
    `- Duels OCR en revue manuelle: ${formatNumber(snapshot.totals.duelOcrManualReview)}`,
    `- Duels OCR en echec: ${formatNumber(snapshot.totals.duelOcrFailed)}`,
    `- Depots OCR matches: ${formatNumber(snapshot.totals.depositOcrMatched)}`,
    `- Depots OCR a revoir: ${formatNumber(snapshot.totals.depositOcrNeedsReview)}`,
    `- Depots OCR en echec: ${formatNumber(snapshot.totals.depositOcrFailed)}`,
    `- Depots OCR en attente: ${formatNumber(snapshot.totals.depositOcrPending)}`
  ];
}

function buildAdminBlocks(snapshot) {
  if (!snapshot) return [];

  const rooms = snapshot.recentRooms.map((room) => {
    const gameName = formatName(room.game, 'n/a');
    const platformName = formatName(room.platform, 'n/a');
    return `${room.name} (${gameName}/${platformName}) | ${formatRoom(room)}`;
  });

  const invitations = snapshot.recentInvitations.map((invitation) => formatPublicInvitation(invitation));
  const duels = snapshot.recentDuels.map((duel) => formatRecentDuel(duel));
  const challenges = snapshot.recentChallenges.map((challenge) => formatRecentChallenge(challenge));
  const profiles = snapshot.recentProfiles.map((profile) => formatProfile(profile));
  const deposits = snapshot.recentPendingDeposits.map((deposit) => formatDeposit(deposit));
  const withdrawals = snapshot.recentPendingWithdrawals.map((withdrawal) => formatWithdrawal(withdrawal));

  return [
    'Contexte administration:',
    `- Salles actives recentes: ${snapshot.recentRooms.length}`,
    ...blockFromList('Salles recentes', rooms),
    ...blockFromList('Invitations ouvertes recentes', invitations),
    ...blockFromList('Duels recents', duels),
    ...blockFromList('Defis recents', challenges),
    ...blockFromList('Profils de jeu recents', profiles),
    ...blockFromList('Depots en attente', deposits),
    ...blockFromList('Retraits en attente', withdrawals)
  ];
}

function buildUserBlocks({ user, wallet, incomingChallenges, outgoingChallenges, activeDuels, recentDuels, recentTransactions, recentNotifications, recentProfiles, recentSessions }) {
  return [
    'Contexte du compte courant:',
    `- Solde disponible: ${formatCurrency(wallet?.balanceAvailable || 0)}`,
    `- Solde bloque: ${formatCurrency(wallet?.balanceLocked || 0)}`,
    `- Solde total: ${formatCurrency(wallet?.balanceTotal || 0)}`,
    `- Total depose: ${formatCurrency(wallet?.totalDeposited || 0)}`,
    `- Total retire: ${formatCurrency(wallet?.totalWithdrawn || 0)}`,
    `- Total gagne: ${formatCurrency(wallet?.totalWon || 0)}`,
    `- Total perdu: ${formatCurrency(wallet?.totalLost || 0)}`,
    `- Defis recus en attente: ${incomingChallenges}`,
    `- Defis envoyes en attente: ${outgoingChallenges}`,
    `- Duels actifs ou en litige: ${activeDuels}`,
    `- Derniers duels termines: ${recentDuels.length}`,
    `- Dernieres operations wallet: ${recentTransactions.length}`,
    `- Notifications recentes: ${recentNotifications.length}`,
    `- Profils de jeu: ${recentProfiles.length}`,
    `- Sessions actives recentes: ${recentSessions.length}`,
    `- Victoires: ${user.wins}`,
    `- Defaites: ${user.losses}`,
    `- Serie courante: ${user.currentStreak}`
  ];
}

async function buildOperationalContext(user) {
  const [snapshot, globalSettings] = await Promise.all([
    fetchGlobalSnapshot(),
    CommissionSetting.find({ active: true }).sort({ minAmount: 1 }).select('name minAmount maxAmount rate type active').lean()
  ]);

  const publicBlocks = buildPublicBlocks(snapshot);
  const settingsBlocks = [
    'Regles de commission actives:',
    ...(globalSettings.length
      ? globalSettings.map((setting) => {
        const maxAmount = setting.maxAmount == null ? 'sans plafond' : formatCurrency(setting.maxAmount);
        return `- ${setting.name}: ${formatNumber(setting.rate * 100)}% | min=${formatCurrency(setting.minAmount)} | max=${maxAmount} | type=${setting.type}`;
      })
      : ['- aucune'])
  ];

  if (!user) {
    return [...publicBlocks, ...settingsBlocks].join('\n');
  }

  const [
    wallet,
    incomingChallenges,
    outgoingChallenges,
    activeDuels,
    recentDuels,
    recentTransactions,
    recentNotifications,
    recentProfiles,
    recentSessions,
    recentInvitations,
    recentChats,
    recentArbitrations,
    recentUsernameRequests,
    recentDeposits,
    recentWithdrawals,
    adminLogs,
    adminArbitrations,
    adminUsernameRequests,
    adminSessions
  ] = await Promise.all([
    Wallet.findOne({ user: user._id }),
    Challenge.countDocuments({ challenged: user._id, status: { $in: ['pending', 'counter_offer'] } }),
    Challenge.countDocuments({ challenger: user._id, status: { $in: ['pending', 'counter_offer'] } }),
    Duel.countDocuments({ $or: [{ player1: user._id }, { player2: user._id }], status: { $in: ['active', 'waiting_player1_proof', 'waiting_player2_proof', 'waiting_result', 'analyzing', 'under_review', 'dispute'] } }),
    Duel.find({ $or: [{ player1: user._id }, { player2: user._id }], status: 'finished' })
      .sort({ finishedAt: -1 })
      .limit(MAX_LIST_ITEMS)
      .populate('player1 player2 winner', 'username country rank')
      .lean(),
    Transaction.find({ user: user._id }).sort({ createdAt: -1 }).limit(MAX_LIST_ITEMS).select('type amount status createdAt description').lean(),
    Notification.find({ user: user._id }).sort({ createdAt: -1 }).limit(MAX_LIST_ITEMS).select('type title body link isRead createdAt').lean(),
    GameProfile.find({ user: user._id })
      .sort({ isPrimary: -1, updatedAt: -1 })
      .limit(MAX_LIST_ITEMS)
      .populate('game platform', 'name slug')
      .lean(),
    Session.find({ user: user._id, isRevoked: false, expiresAt: { $gt: new Date() } })
      .sort({ lastActivity: -1 })
      .limit(MAX_LIST_ITEMS)
      .select('deviceType browser os location telegramWebApp lastActivity createdAt')
      .lean(),
    PublicInvitation.find({ host: user._id })
      .sort({ createdAt: -1 })
      .limit(MAX_LIST_ITEMS)
      .populate('room', 'name betAmount')
      .lean(),
    ChatMessage.find({ sender: user._id })
      .sort({ createdAt: -1 })
      .limit(MAX_LIST_ITEMS)
      .populate('challenge', 'roomId status')
      .lean(),
    Arbitration.find({ $or: [{ challenger: user._id }, { opponent: user._id }, { arbitrator: user._id }] })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(MAX_LIST_ITEMS)
      .populate('duel', 'roomId status')
      .lean(),
    UsernameChangeRequest.find({ user: user._id })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(MAX_LIST_ITEMS)
      .lean(),
    Deposit.find({ user: user._id }).sort({ createdAt: -1 }).limit(MAX_LIST_ITEMS).select('method amount status autoVerificationStatus createdAt').lean(),
    Withdrawal.find({ user: user._id }).sort({ createdAt: -1 }).limit(MAX_LIST_ITEMS).select('method amount status netAmount createdAt').lean(),
    user.role === 'admin'
      ? AdminLog.find().sort({ createdAt: -1 }).limit(MAX_LIST_ITEMS).select('action targetType targetId createdAt note').lean()
      : [],
    user.role === 'admin'
      ? Arbitration.find({ status: { $in: ['pending', 'in_review', 'escalated'] } })
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(MAX_LIST_ITEMS)
        .populate('duel challenger opponent arbitrator', 'username country rank')
        .lean()
      : [],
    user.role === 'admin'
      ? UsernameChangeRequest.find({ status: 'pending' })
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(MAX_LIST_ITEMS)
        .populate('user reviewedBy', 'username country rank')
        .lean()
      : [],
    user.role === 'admin'
      ? Session.find({ isRevoked: false, expiresAt: { $gt: new Date() } })
        .sort({ lastActivity: -1 })
        .limit(MAX_LIST_ITEMS)
        .populate('user', 'username country rank role')
        .lean()
      : []
  ]);

  const userBlocks = [
    ...publicBlocks,
    ...settingsBlocks,
    'Contexte OCR:',
    `- Duels OCR auto-valides: ${formatNumber(snapshot?.totals.duelOcrAutoApproved || 0)}`,
    `- Duels OCR en revue manuelle: ${formatNumber(snapshot?.totals.duelOcrManualReview || 0)}`,
    `- Duels OCR en echec: ${formatNumber(snapshot?.totals.duelOcrFailed || 0)}`,
    `- Depots OCR matches: ${formatNumber(snapshot?.totals.depositOcrMatched || 0)}`,
    `- Depots OCR a revoir: ${formatNumber(snapshot?.totals.depositOcrNeedsReview || 0)}`,
    `- Depots OCR en echec: ${formatNumber(snapshot?.totals.depositOcrFailed || 0)}`,
    `- Depots OCR en attente: ${formatNumber(snapshot?.totals.depositOcrPending || 0)}`,
    ...buildUserBlocks({
      user,
      wallet,
      incomingChallenges,
      outgoingChallenges,
      activeDuels,
      recentDuels,
      recentTransactions,
      recentNotifications,
      recentProfiles,
      recentSessions
    }),
    'Activite recente du compte:',
    ...blockFromList(
      'Derniers dépots',
      recentDeposits.map((deposit) => `${deposit.method} | ${formatCurrency(deposit.amount)} | ${deposit.status} | ${formatDateTime(deposit.createdAt)}`)
    ),
    ...blockFromList(
      'Derniers retraits',
      recentWithdrawals.map((withdrawal) => `${withdrawal.method} | ${formatCurrency(withdrawal.amount)} | ${withdrawal.status} | net=${formatCurrency(withdrawal.netAmount)} | ${formatDateTime(withdrawal.createdAt)}`)
    ),
    ...blockFromList(
      'Dernieres notifications',
      recentNotifications.map((notification) => `${notification.title} | ${notification.type} | lu=${notification.isRead ? 'oui' : 'non'} | ${formatDateTime(notification.createdAt)}`)
    ),
    ...blockFromList(
      'Derniers arbitrages',
      recentArbitrations.map((arbitration) => `${formatName(arbitration.duel, 'n/a')} | ${arbitration.status} | ${formatDateTime(arbitration.updatedAt)}`)
    ),
    ...blockFromList(
      'Dernières demandes de changement de pseudo',
      recentUsernameRequests.map((request) => `${request.currentUsername} -> ${request.requestedUsername} | ${request.status} | ${formatDateTime(request.updatedAt)}`)
    ),
    ...blockFromList(
      'Dernières invitations publiques',
      recentInvitations.map((invitation) => formatPublicInvitation(invitation))
    ),
    ...blockFromList(
      'Derniers messages',
      recentChats.map((chat) => `${formatName(chat.challenge, 'n/a')} | ${chat.message} | ${formatDateTime(chat.createdAt)}`)
    ),
    ...(user.role === 'admin'
      ? [
        ...buildAdminBlocks(snapshot),
        ...blockFromList(
          'Arbitrages en attente',
          adminArbitrations.map((arbitration) => `${formatName(arbitration.duel, 'n/a')} | ${arbitration.status} | ${formatName(arbitration.challenger, 'n/a')} vs ${formatName(arbitration.opponent, 'n/a')}`)
        ),
        ...blockFromList(
          'Demandes de pseudo en attente',
          adminUsernameRequests.map((request) => `${request.currentUsername} -> ${request.requestedUsername} | ${request.status} | ${formatName(request.user, 'n/a')}`)
        ),
        ...blockFromList(
          'Sessions actives globales',
          adminSessions.map((session) => `${formatName(session.user, 'n/a')} | ${session.deviceType || 'unknown'} | ${session.browser || 'unknown'} | ${formatDateTime(session.lastActivity)}`)
        )
      ]
      : [])
  ];

  if (user.role === 'admin') {
    userBlocks.push(
      'Contexte admin supplementaire:',
      ...blockFromList(
        'Derniers logs admin',
        adminLogs.map((entry) => formatAdminLog(entry))
      )
    );
  }

  return userBlocks.join('\n');
}

function buildLocalAssistantReply({ user, prompt, view, context }) {
  if (isGreetingPrompt(prompt)) {
    return buildTimeGreetingReply({ user, view });
  }
  const text = normalizeText(prompt);
  const trust = user ? buildTrustProfile(user) : null;
  const assistantIsAdmin = env.aiAssistantRole === 'admin';
  const commonIntro = user
    ? `Je suis ${assistantIsAdmin ? 'l assistant administrateur' : 'l assistant global'} SKILL2CASH pour ta vue ${view || 'global'}.`
    : `Je suis ${assistantIsAdmin ? 'l assistant administrateur' : 'l assistant global'} SKILL2CASH.`;

  if (assistantIsAdmin && /(ocr|preuve|capture|validation automatique|validation manuelle|depot|dépôt|retrait|wallet|solde|litige|match|duel)/.test(text)) {
    return {
      reply: [
        commonIntro,
        'Je vois tout le pipeline admin du site.',
        'Depots: une capture est analysee par OCR, puis marquee matched, needs_review ou failed. Si la preuve est coherente, le wallet est credite apres validation.',
        'Retraits: la demande passe en attente, puis est approuvee, rejetee ou payee par l admin, avec mise a jour du wallet et notification.',
        'Matchs: le defi est cree, les fonds sont bloques, la salle s ouvre, chaque joueur envoie sa preuve, OCR compare les captures, puis le systeme valide, ouvre un litige ou paye le vainqueur.',
        'Je peux aussi t expliquer la confiance du joueur, les files en attente, les comptes touches et les actions admin prioritaires si tu veux.',
        'Je peux aussi te donner les files en attente, les comptes touches et les actions admin prioritaires si tu veux.'
      ].join('\n'),
      provider: 'local-fallback',
      model: 'local'
    };
  }

  if (/(wallet|portefeuille|solde|retrait|depot|depôt)/.test(text)) {
    return {
      reply: [
        commonIntro,
        'Le wallet separe le solde disponible, le solde bloque et les operations validees.',
        user
          ? `Pour ton compte: le solde et les mouvements sont visibles dans le wallet, avec une confiance de ${trust?.score ?? 0}/100.`
          : 'Ouvre le wallet pour voir ton solde, tes depots et tes retraits.',
        'Si tu veux, je peux te dire quoi faire pour deposer ou retirer.'
      ].join('\n'),
      provider: 'local-fallback',
      model: 'local'
    };
  }

  if (assistantIsAdmin && /(supprime|supprimer|annule|annuler|efface|effacer|ferme|fermer).*(defi|défi|challenge|salle|duel)/.test(text)) {
    return {
      reply: [
        commonIntro,
        'En mode administrateur, je peux te guider sur la gestion des défis et des salles.',
        'Les défis ouverts sont accessibles dans le panneau admin et peuvent être annulés ou traités depuis la file d attente.',
        'Par sécurité, je ne prétends pas avoir supprimé une donnée tant que l action admin dédiée n a pas été exécutée.',
        'Si tu veux, je peux maintenant te résumer les défis ouverts, les duels en cours et les litiges à traiter.'
      ].join('\n'),
      provider: 'local-fallback',
      model: 'local'
    };
  }

  if (/(profil|profile|compte|mon profil)/.test(text)) {
    return {
      reply: [
        commonIntro,
        user
          ? `Ton profil affiche ${user.wins} victoire(s), ${user.losses} defaite(s), une serie de ${user.currentStreak} et une confiance de ${trust?.score ?? 0}/100.`
          : 'Le profil affiche les informations publiques du joueur, sa confiance et son activite.',
        'Je peux aussi t expliquer chaque bloc du profil si tu veux.'
      ].join('\n'),
      provider: 'local-fallback',
      model: 'local'
    };
  }

  if (/(confiance|trust)/.test(text)) {
    const signals = trust?.signals?.slice(0, 3).map((signal) => signal.label).join(' · ') || 'signaux de fiabilite, activite et litiges';
    return {
      reply: [
        commonIntro,
        'La confiance resume la fiabilite du joueur sur 100.',
        `Niveau actuel: ${trust?.score ?? 0}/100. ${trust?.tierLabel || 'Profil evalue automatiquement'}.`,
        `Signaux cles: ${signals}.`
      ].join('\n'),
      provider: 'local-fallback',
      model: 'local'
    };
  }

  if (/(defi|defi|duel|lancer|challenge)/.test(text)) {
    return {
      reply: [
        commonIntro,
        'Pour lancer un defi: choisis un joueur, definit la mise, verifie ton solde disponible, puis envoie la demande.',
        'Le systeme bloque la mise, ouvre la salle du duel et suit le resultat jusqu a la validation.',
        assistantIsAdmin
          ? 'En mode admin, je peux aussi t expliquer le nombre de salles ouvertes, les preuves en attente et les duels en litige.'
          : 'Je peux te guider etape par etape si tu veux.'
      ].join('\n'),
      provider: 'local-fallback',
      model: 'local'
    };
  }

  if (/(joueur|affront|adversaire|rencontre)/.test(text)) {
    return {
      reply: [
        commonIntro,
        'Je peux chercher un joueur deja affronte si tu me le demandes clairement.',
        'Exemple: "Trouve-moi un joueur deja affronte".'
      ].join('\n'),
      provider: 'local-fallback',
      model: 'local'
    };
  }

  const contextSummary = context
    ? 'Le site suit les defis, les duels, le wallet, la confiance, les salles, les invitations, les depots, les retraits, l OCR et les actions admin.'
    : 'Je peux t expliquer les pages du site, les duels, le wallet et la confiance.';

  return {
    reply: [
      commonIntro,
      contextSummary,
      user
        ? 'Je peux aussi t aider avec ton profil, ton wallet, tes defis, un joueur deja affronte ou une action admin.'
        : 'Pose-moi une question precise et je te repondrai directement.'
    ].join('\n'),
    provider: 'local-fallback',
    model: 'local'
  };
}

function summarizePastOpponents(duels, user) {
  const map = new Map();

  for (const duel of duels) {
    const opponent = String(duel.player1?._id || duel.player1) === String(user._id) ? duel.player2 : duel.player1;
    if (!opponent) continue;
    const key = String(opponent._id || opponent);
    const current = map.get(key) || {
      id: key,
      username: opponent.username || 'Inconnu',
      country: opponent.country || '',
      rank: opponent.rank || '',
      wins: 0,
      lastPlayedAt: duel.finishedAt || duel.updatedAt || duel.createdAt
    };
    current.wins += String(duel.winner?._id || duel.winner) === String(user._id) ? 1 : 0;
    if (new Date(duel.finishedAt || duel.updatedAt || duel.createdAt) > new Date(current.lastPlayedAt || 0)) {
      current.lastPlayedAt = duel.finishedAt || duel.updatedAt || duel.createdAt;
    }
    map.set(key, current);
  }

  return [...map.values()].sort((a, b) => new Date(b.lastPlayedAt) - new Date(a.lastPlayedAt));
}

async function findPastOpponents(user, query) {
  const normalizeQuery = normalizeText(query);
  const duels = await Duel.find({
    $or: [{ player1: user._id }, { player2: user._id }],
    status: { $in: ['finished', 'active', 'waiting_result', 'dispute'] }
  })
    .populate('player1 player2 winner', 'username avatar country rank')
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(120)
    .lean();

  const opponents = summarizePastOpponents(duels, user);
  const filtered = normalizeQuery
    ? opponents.filter((opponent) => normalizeText(opponent.username).includes(normalizeQuery))
    : opponents;

  const selection = filtered.slice(0, 5);
  if (!selection.length) {
    return {
      reply: normalizeQuery
        ? `Je n ai trouve aucun joueur deja affronte correspondant a "${query}".`
        : 'Je n ai pas encore d adversaire historique a te montrer.',
      provider: 'local-action',
      action: 'find_past_opponents',
      data: { query, opponents: [] }
    };
  }

  const lines = selection.map((opponent, index) => {
    const lastPlayed = new Date(opponent.lastPlayedAt).toLocaleDateString('fr-FR');
    const record = `${opponent.wins} victoire${opponent.wins > 1 ? 's' : ''} contre lui`;
    const meta = [opponent.country, opponent.rank].filter(Boolean).join(' · ');
    return `${index + 1}. ${opponent.username}${meta ? ` (${meta})` : ''} - dernier duel: ${lastPlayed} - ${record}`;
  });

  return {
    reply: normalizeQuery
      ? `J ai trouve ces joueurs deja affronte correspondant a "${query}":\n${lines.join('\n')}`
      : `Voici les joueurs que tu as deja affronte recemment:\n${lines.join('\n')}`,
    provider: 'local-action',
    action: 'find_past_opponents',
    data: { query, opponents: selection }
  };
}

function shouldResolveLocalAction(prompt) {
  const text = normalizeText(prompt);
  return (
    /joueur/.test(text) &&
    (/deja joue|deja joue avec|avec qui j'ai joue|avec qui jai joue|qui j'ai deja joue|qui jai deja joue|adversaire|rencontre/.test(text) ||
      /cherche.*joueur|trouve.*joueur|retrouve.*joueur/.test(text))
  );
}

function shouldResolveAdminAction(prompt, user, history = []) {
  if (!user || user.role !== 'admin') return false;
  const text = normalizeText(prompt);
  const historyText = normalizeText(history.map((message) => message.content).join(' '));
  const challengeContext = /(defi|defis|défi|défis|challenge|challenges|salle|salles|duel|duels)/.test(text) || /(defi|defis|défi|défis|challenge|challenges|salle|salles|duel|duels)/.test(historyText);
  return (
    /(supprime|supprimer|annule|annuler|nettoie|nettoyer|efface|effacer)/.test(text) &&
    challengeContext &&
    /(tout|toutes|les toutes|l ensemble|ensemble|open|ouverts)/.test(text)
  );
}

async function resolveAdminAction(prompt, user, history = []) {
  if (!shouldResolveAdminAction(prompt, user, history)) return null;

  const cleanup = await cancelOpenChallenges(user._id, { note: 'Nettoyage admin via assistant IA' });
  const count = cleanup.count || 0;
  return {
    reply: count
      ? `J ai nettoyé ${count} défi${count > 1 ? 's' : ''} ouvert${count > 1 ? 's' : ''}. Ils ont été annulés et retirés de la file publique.`
      : 'Aucun défi ouvert à nettoyer.',
    provider: 'local-action',
    action: 'cleanup_open_challenges',
    data: {
      count,
      challengeIds: cleanup.challengeIds || []
    }
  };
}

async function executeOfficialAdminAction({ user, adminAction, confirmToken }) {
  if (!adminAction || typeof adminAction !== 'object') return null;
  if (!user || user.role !== 'admin') {
    throw new AppError('Accès admin requis pour exécuter une action IA officielle', 403);
  }

  const type = String(adminAction.type || '').trim();
  if (!type) throw new AppError('adminAction.type est requis', 422);
  if (isCriticalOfficialAction(type) && confirmToken !== OFFICIAL_ADMIN_CONFIRM_TOKEN) {
    throw new AppError(`Confirmation requise. Fournissez confirmToken=${OFFICIAL_ADMIN_CONFIRM_TOKEN}`, 422);
  }

  let result;
  switch (type) {
    case 'cleanup_open_challenges': {
      const note = String(adminAction.note || 'Nettoyage admin via assistant IA officiel').trim().slice(0, 300);
      result = await cancelOpenChallenges(user._id, { note });
      break;
    }
    case 'approve_deposit': {
      requireValidObjectId(adminAction.depositId, 'depositId');
      const deposit = await approveManualDeposit(adminAction.depositId, user._id, String(adminAction.note || '').trim().slice(0, 300));
      result = { depositId: String(deposit._id), status: deposit.status };
      break;
    }
    case 'reject_deposit': {
      requireValidObjectId(adminAction.depositId, 'depositId');
      const deposit = await rejectManualDeposit(adminAction.depositId, user._id, String(adminAction.note || '').trim().slice(0, 300));
      result = { depositId: String(deposit._id), status: deposit.status };
      break;
    }
    case 'approve_withdrawal': {
      requireValidObjectId(adminAction.withdrawalId, 'withdrawalId');
      const session = await mongoose.startSession();
      try {
        const withdrawal = await session.withTransaction(async () => {
          const doc = await Withdrawal.findById(adminAction.withdrawalId).session(session);
          if (!doc) throw new AppError('Retrait non trouvé', 404);
          if (doc.status !== 'pending') throw new AppError('Retrait déjà traité', 422);
          doc.status = adminAction.markPaid ? 'paid' : 'approved';
          doc.adminNote = String(adminAction.note || '').trim().slice(0, 300);
          await doc.save({ session });
          await Transaction.updateOne(
            { referenceId: doc._id, type: 'withdraw' },
            { $set: { status: doc.status === 'paid' ? 'success' : 'pending' } },
            { session }
          );
          return doc;
        });
        result = { withdrawalId: String(withdrawal._id), status: withdrawal.status };
      } finally {
        await session.endSession();
      }
      break;
    }
    case 'reject_withdrawal': {
      requireValidObjectId(adminAction.withdrawalId, 'withdrawalId');
      const session = await mongoose.startSession();
      try {
        const withdrawal = await session.withTransaction(async () => {
          const doc = await Withdrawal.findById(adminAction.withdrawalId).session(session);
          if (!doc) throw new AppError('Retrait non trouvé', 404);
          if (doc.status !== 'pending') throw new AppError('Retrait déjà traité', 422);
          doc.status = 'rejected';
          doc.adminNote = String(adminAction.note || 'Rejected by assistant official').trim().slice(0, 300);
          await doc.save({ session });
          await adjustBalance(
            doc.user,
            doc.amount,
            `Remboursement de retrait rejeté: ${doc.adminNote}`,
            session,
            'add'
          );
          await Transaction.updateOne(
            { referenceId: doc._id, type: 'withdraw' },
            { $set: { status: 'cancelled' } },
            { session }
          );
          return doc;
        });
        result = { withdrawalId: String(withdrawal._id), status: withdrawal.status };
      } finally {
        await session.endSession();
      }
      break;
    }
    case 'resolve_dispute_winner': {
      requireValidObjectId(adminAction.duelId, 'duelId');
      requireValidObjectId(adminAction.winnerId, 'winnerId');
      const duel = await finishDuel(adminAction.duelId, adminAction.winnerId);
      result = { duelId: String(duel._id), status: duel.status, winnerId: String(duel.winner) };
      break;
    }
    case 'resolve_dispute_cancel': {
      requireValidObjectId(adminAction.duelId, 'duelId');
      const duel = await cancelDuel(adminAction.duelId, String(adminAction.reason || 'Dispute resolved by assistant official').trim().slice(0, 300));
      result = { duelId: String(duel._id), status: duel.status };
      break;
    }
    case 'ban_user': {
      requireValidObjectId(adminAction.userId, 'userId');
      const userDoc = await User.findByIdAndUpdate(
        adminAction.userId,
        { isBanned: Boolean(adminAction.isBanned ?? true) },
        { new: true }
      ).select('_id username isBanned');
      if (!userDoc) throw new AppError('Utilisateur non trouvé', 404);
      result = { userId: String(userDoc._id), isBanned: userDoc.isBanned };
      break;
    }
    case 'adjust_balance': {
      requireValidObjectId(adminAction.userId, 'userId');
      const amount = Number(adminAction.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new AppError('Montant invalide', 422);
      if (!adminAction.description) throw new AppError('description est requise', 422);
      const operation = String(adminAction.operation || '').toLowerCase();
      if (!['add', 'subtract'].includes(operation)) {
        throw new AppError('operation doit être add ou subtract', 422);
      }
      const wallet = await adjustBalance(adminAction.userId, amount, String(adminAction.description).slice(0, 300), null, operation);
      result = { userId: String(adminAction.userId), balanceAvailable: wallet.balanceAvailable, balanceTotal: wallet.balanceTotal };
      break;
    }
    default:
      throw new AppError('Type d action adminAction inconnu', 422);
  }

  const targetId = resolveAdminActionTargetId(type, adminAction, user);
  if (!targetId) {
    throw new AppError('Impossible de déterminer la cible du log admin', 422);
  }
  await AdminLog.create({
    admin: user._id,
    action: `assistant_official:${type}`,
    targetType: 'AssistantAction',
    targetId,
    note: String(adminAction.note || '').trim().slice(0, 300),
    metadata: {
      actor: 'assistant_official',
      confirmTokenProvided: Boolean(confirmToken),
      payload: adminAction,
      result
    }
  });

  return {
    reply: `Action admin officielle exécutée: ${type}.`,
    provider: 'assistant-official-action',
    action: type,
    data: result
  };
}

function extractOpponentSearchQuery(prompt) {
  const raw = String(prompt ?? '').trim();
  const explicitPatterns = [
    /joueur\s+(?:nomme|appel[eé]|nom|pseudo)\s+(.+)/i,
    /avec\s+(?:le\s+)?(?:nom|pseudo)\s+(.+)/i,
    /cherche(?:-moi)?\s+(?:un\s+)?joueur\s+(.+)/i
  ];

  for (const pattern of explicitPatterns) {
    const match = raw.match(pattern);
    if (!match?.[1]) continue;
    const query = trimText(match[1].replace(/^(?:nomme|nommé|appelle|appelé|nom|pseudo)\s+/i, '').replace(/[?.!,]$/g, ''));
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery || /^(deja|déjà|affronte|affronté|affrontee|joue|joué|historique|recent|recemment)$/.test(normalizedQuery)) {
      continue;
    }
    return query;
  }

  return '';
}

async function callAnthropicLikeApi({ messages, system, model, maxTokens }) {
  const url = resolveProviderUrl(env.aiBaseUrl, '/v1/messages');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...resolveAuthHeaders(env.aiBaseUrl)
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages
    })
  });

  if (!response.ok) {
    throw new AppError(`IA indisponible (${response.status})`, 503);
  }

  const data = await response.json();
  const reply = extractAnthropicText(data);
  if (!reply) throw new AppError('Reponse IA vide', 503);
  return { reply, provider: 'anthropic', model: data.model || model };
}

async function callOpenAICompatibleApi({ messages, system, model, maxTokens }) {
  const url = resolveProviderUrl(env.aiBaseUrl, '/v1/chat/completions');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...resolveAuthHeaders(env.aiBaseUrl)
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...messages],
      max_tokens: maxTokens
    })
  });

  if (!response.ok) {
    throw new AppError(`IA indisponible (${response.status})`, 503);
  }

  const data = await response.json();
  const reply = extractOpenAIText(data);
  if (!reply) throw new AppError('Reponse IA vide', 503);
  return { reply, provider: 'openai-compatible', model: data.model || model };
}

export async function generateAssistantReply({ req, message, messages = [], view = 'global', adminAction = null, confirmToken = '' }) {
  const prompt = trimText(message);
  if (!prompt) {
    throw new AppError("Le message de l assistant est requis", 422);
  }

  const history = normalizeMessages(messages);
  const user = await resolveOptionalUser(req);
  if (isGreetingPrompt(prompt)) {
    return enrichAssistantResponse(buildTimeGreetingReply({ user }), { user, view, prompt });
  }
  if (adminAction) {
    return enrichAssistantResponse(executeOfficialAdminAction({ user, adminAction, confirmToken }), { user, view, prompt });
  }
  if (user && shouldResolveLocalAction(prompt)) {
    const query = extractOpponentSearchQuery(prompt);
    return enrichAssistantResponse(findPastOpponents(user, query), { user, view, prompt });
  }
  if (user && shouldResolveAdminAction(prompt, user, history)) {
    return enrichAssistantResponse(resolveAdminAction(prompt, user, history), { user, view, prompt });
  }

  if (!env.aiToken) {
    return enrichAssistantResponse(buildLocalAssistantReply({ user, prompt, view, context: '' }), { user, view, prompt });
  }

  const context = await buildOperationalContext(user);

  const system = buildSystemPrompt({ user, view, context });
  const payloadMessages = [...history, { role: 'user', content: prompt }];
  const maxTokens = Math.max(256, Number(env.aiMaxTokens) || 700);

  const providers = env.aiModel.startsWith('gpt-') || !looksLikeAnthropicBaseUrl(env.aiBaseUrl)
    ? [callOpenAICompatibleApi, callAnthropicLikeApi]
    : [callAnthropicLikeApi, callOpenAICompatibleApi];
  for (const provider of providers) {
    try {
      const response = await provider({ messages: payloadMessages, system, model: env.aiModel, maxTokens });
      return enrichAssistantResponse(response, { user, view, prompt });
    } catch (error) {
      void error;
    }
  }

  return enrichAssistantResponse(buildLocalAssistantReply({ user, prompt, view, context }), { user, view, prompt });
}

export {
  buildLocalAssistantReply,
  buildOperationalContext,
  buildSystemPrompt,
  normalizeMessages,
  resolveProviderUrl,
  extractAnthropicText,
  extractOpenAIText,
  looksLikeAnthropicBaseUrl,
  resolveAuthHeaders,
  shouldResolveLocalAction,
  extractOpponentSearchQuery,
  findPastOpponents,
  executeOfficialAdminAction
};
