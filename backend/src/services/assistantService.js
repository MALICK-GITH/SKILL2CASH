import { env } from '../config/env.js';
import { Challenge } from '../models/Challenge.js';
import { AdminLog } from '../models/AdminLog.js';
import { Duel } from '../models/Duel.js';
import { User } from '../models/User.js';
import { Transaction } from '../models/Transaction.js';
import { Wallet } from '../models/Wallet.js';
import { AppError } from '../utils/AppError.js';
import { buildTrustProfile } from './trustService.js';

const MAX_HISTORY_MESSAGES = 10;
const MAX_MESSAGE_LENGTH = 2000;

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

function buildSystemPrompt({ user, view, context }) {
  const baseRules = [
    'Tu es l’assistant officiel global de SKILL2CASH.',
    'Réponds en français, avec des phrases courtes, claires et précises.',
    'Tu dois connaître le site, ses pages, ses règles et ses flux principaux.',
    'N’invente jamais un solde, un score, un statut ou une action non vérifiée.',
    'Si une donnée manque, dis-le franchement et propose la bonne page ou la bonne action.',
    'Si la demande touche à un rôle admin, précise quand une action est réservée à l’admin.',
    'Quand c’est utile, donne une réponse en étapes numérotées très courtes.'
  ];

  const userBlock = user
    ? [
        `Utilisateur connecté: ${user.username} (${user.role}).`,
        `Contexte compte: pays=${user.country}, niveau=${user.level}, statut=${user.status}, rang=${user.rank}, badge=${user.badge}.`,
        `Performance: wins=${user.wins}, losses=${user.losses}, streak=${user.currentStreak}, earnings=${user.totalEarnings}, reputation=${user.reputation}, reports=${user.reportsCount}.`,
        `Confiance: ${JSON.stringify(buildTrustProfile(user)).replaceAll('\n', ' ')}`
      ]
    : ['Utilisateur non connecté. Réponds uniquement avec les informations publiques du site.'];

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

async function buildOperationalContext(user) {
  const publicBlocks = [
    'Fonctionnement du site:',
    '- Défis: un joueur défie un autre avec une mise autorisée par son solde disponible.',
    '- Duels: le résultat est soumis par les joueurs, validé par OCR, puis traité automatiquement ou en litige.',
    '- Portefeuille: dépôts, retraits, mises bloquées et remboursements sont séparés.',
    '- Classement: gains, victoires, taux de victoire et fiabilité sont visibles.',
    '- Communauté: le lien officiel public est WhatsApp, pas Discord.'
  ];

  if (!user) {
    const [activeDuels, liveChallenges] = await Promise.all([
      Duel.countDocuments({ status: { $in: ['active', 'waiting_result', 'dispute'] } }),
      Challenge.countDocuments({ status: { $in: ['pending', 'counter_offer'] } })
    ]);

    return [
      ...publicBlocks,
      'Contexte global du site:',
      `- Duels actifs ou en litige: ${activeDuels}`,
      `- Défis publics ouverts: ${liveChallenges}`
    ].join('\n');
  }

  const [wallet, incomingChallenges, outgoingChallenges, activeDuels, recentDuels, recentTransactions, adminLogs] = await Promise.all([
    Wallet.findOne({ user: user._id }),
    Challenge.countDocuments({ challenged: user._id, status: { $in: ['pending', 'counter_offer'] } }),
    Challenge.countDocuments({ challenger: user._id, status: { $in: ['pending', 'counter_offer'] } }),
    Duel.countDocuments({ $or: [{ player1: user._id }, { player2: user._id }], status: { $in: ['active', 'waiting_result', 'dispute'] } }),
    Duel.find({ $or: [{ player1: user._id }, { player2: user._id }], status: 'finished' })
      .sort({ finishedAt: -1 })
      .limit(5)
      .select('status potTotal finishedAt winner player1 player2'),
    Transaction.find({ user: user._id }).sort({ createdAt: -1 }).limit(5).select('type amount status createdAt description'),
    user.role === 'admin'
      ? AdminLog.find().sort({ createdAt: -1 }).limit(5).select('action targetType targetId createdAt note')
      : []
  ]);

  const userBlocks = [
    ...publicBlocks,
    'Contexte du compte courant:',
    `- Solde disponible: ${wallet?.balanceAvailable || 0}`,
    `- Solde bloqué: ${wallet?.balanceLocked || 0}`,
    `- Défis reçus en attente: ${incomingChallenges}`,
    `- Défis envoyés en attente: ${outgoingChallenges}`,
    `- Duels actifs ou en litige: ${activeDuels}`,
    `- Derniers duels terminés: ${recentDuels.length}`,
    `- Dernières opérations wallet: ${recentTransactions.length}`,
    ...(user.role === 'admin' ? [`- Derniers logs admin: ${adminLogs.length}`] : [])
  ];

  return userBlocks.join('\n');
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
        ? `Je n’ai trouvé aucun joueur déjà affronté correspondant à "${query}".`
        : 'Je n’ai pas encore d’adversaire historique à te montrer.',
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
      ? `J’ai trouvé ces joueurs déjà affrontés correspondant à "${query}":\n${lines.join('\n')}`
      : `Voici les joueurs que tu as déjà affrontés récemment:\n${lines.join('\n')}`,
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
  if (!reply) throw new AppError('Réponse IA vide', 503);
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
  if (!reply) throw new AppError('Réponse IA vide', 503);
  return { reply, provider: 'openai-compatible', model: data.model || model };
}

export async function generateAssistantReply({ req, message, messages = [], view = 'global' }) {
  const prompt = trimText(message);
  if (!prompt) {
    throw new AppError('Le message de l’assistant est requis', 422);
  }

  const history = normalizeMessages(messages);
  const user = await resolveOptionalUser(req);
  if (user && shouldResolveLocalAction(prompt)) {
    const query = extractOpponentSearchQuery(prompt);
    return findPastOpponents(user, query);
  }
  if (!env.aiToken) {
    throw new AppError('L’assistant IA n’est pas configuré', 503);
  }

  const context = await buildOperationalContext(user);
  const system = buildSystemPrompt({ user, view, context });
  const payloadMessages = [...history, { role: 'user', content: prompt }];
  const maxTokens = Math.max(256, Number(env.aiMaxTokens) || 700);

  const providers = env.aiModel.startsWith('gpt-') || !looksLikeAnthropicBaseUrl(env.aiBaseUrl)
    ? [callOpenAICompatibleApi, callAnthropicLikeApi]
    : [callAnthropicLikeApi, callOpenAICompatibleApi];
  const errors = [];

  for (const provider of providers) {
    try {
      return await provider({ messages: payloadMessages, system, model: env.aiModel, maxTokens });
    } catch (error) {
      errors.push(error);
    }
  }

  throw errors[errors.length - 1] || new AppError('Impossible de joindre l’assistant IA', 503);
}

export { buildOperationalContext, buildSystemPrompt, normalizeMessages, resolveProviderUrl, extractAnthropicText, extractOpenAIText, looksLikeAnthropicBaseUrl, resolveAuthHeaders, shouldResolveLocalAction, extractOpponentSearchQuery, findPastOpponents };
