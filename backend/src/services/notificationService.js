import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import {
  defaultPriorityForPublicType,
  mapDomainEventToPublicType,
  NOTIFICATION_PUBLIC_TYPES
} from '../constants/notificationPublicTypes.js';

let ioInstance = null;

const PRIORITY_ENUM = new Set(['low', 'normal', 'medium', 'high', 'urgent']);

/** Payload public pour Socket (aligné spec client). */
export function serializePublicNotification(doc) {
  const o = doc && typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  return {
    _id: o._id,
    userId: o.user,
    type: o.type,
    title: o.title || '',
    message: o.body || '',
    data: o.metadata && typeof o.metadata === 'object' ? o.metadata : {},
    read: Boolean(o.isRead),
    priority: o.priority || 'medium',
    link: o.link || '',
    createdAt: o.createdAt,
    domainEvent: o.domainEvent || undefined
  };
}

function buildNotificationContent(event, payload = {}) {
  switch (event) {
    case 'auth:login':
      return { title: 'Connexion réussie', body: 'Une nouvelle connexion à votre compte a été détectée.' };
    case 'profile:updated':
      return { title: 'Profil mis à jour', body: 'Vos informations de profil ont bien été enregistrées.' };
    case 'profile:status_changed':
      return { title: 'Statut modifié', body: `Votre statut est maintenant ${payload.statusLabel || payload.status || 'mis à jour'}.` };
    case 'username:change_requested':
      return { title: 'Demande envoyée', body: 'Votre demande de changement eFootball est en attente.' };
    case 'deposit:submitted':
      return { title: 'Dépôt soumis', body: `Dépôt de ${payload.amount || 0} CFA en attente de validation.` };
    case 'deposit:ocr_processing':
      return { title: 'OCR en cours', body: 'Votre preuve de dépôt est en cours d analyse par le backend.' };
    case 'deposit:ocr_matched':
      return { title: 'OCR favorable', body: 'La preuve de dépôt semble cohérente et peut être validée automatiquement.' };
    case 'deposit:ocr_review_required':
      return { title: 'OCR à vérifier', body: 'La preuve de dépôt nécessite une validation manuelle.' };
    case 'deposit:approved':
      return { title: 'Dépôt validé', body: `Votre dépôt de ${payload.amount || 0} CFA a été crédité.` };
    case 'deposit:rejected':
      return { title: 'Dépôt rejeté', body: payload.note || 'Votre dépôt a été rejeté.' };
    case 'withdrawal:submitted':
      return { title: 'Retrait soumis', body: `Retrait de ${payload.amount || 0} CFA en attente de validation.` };
    case 'withdrawal:processing':
      return { title: 'Retrait en cours', body: 'Votre demande de retrait est en cours de vérification par le backend.' };
    case 'withdrawal:review_required':
      return { title: 'Retrait à vérifier', body: 'Le retrait est en attente de validation admin.' };
    case 'withdrawal:approved':
      return { title: 'Retrait validé', body: 'Votre retrait a été approuvé.' };
    case 'withdrawal:rejected':
      return { title: 'Retrait rejeté', body: 'Votre retrait a été rejeté.' };
    case 'withdrawal:paid':
      return { title: 'Retrait payé', body: 'Votre retrait a été marqué comme payé.' };
    case 'admin:deposit_pending':
      return { title: 'Dépôt à traiter', body: `Dépôt de ${payload.amount || 0} CFA à valider.` };
    case 'admin:deposit_reviewed':
      return { title: 'Dépôt traité', body: `Le dépôt de ${payload.amount || 0} CFA a été ${payload.action === 'rejected' ? 'rejeté' : 'validé'}.` };
    case 'admin:withdrawal_pending':
      return { title: 'Retrait à traiter', body: `Retrait de ${payload.amount || 0} CFA à valider.` };
    case 'admin:withdrawal_reviewed':
      return { title: 'Retrait traité', body: `Le retrait de ${payload.amount || 0} CFA a été ${payload.action === 'rejected' ? 'rejeté' : 'validé'}.` };
    case 'admin:dispute_pending':
      return {
        title: 'Litige duel',
        body: payload.reason
          ? `Un duel nécessite votre décision: ${payload.reason}`
          : 'Un duel est passé en litige et nécessite votre intervention.'
      };
    case 'admin:dispute_resolved':
      return { title: 'Litige résolu', body: payload.action === 'cancel' ? 'Le litige a été annulé.' : 'Le litige a été résolu avec gagnant.' };
    case 'admin:username_change_pending':
      return { title: 'Changement de pseudo', body: 'Une demande de changement eFootball attend une décision.' };
    case 'admin:new_user':
      return { title: 'Nouvel utilisateur', body: payload.body || 'Un nouvel utilisateur vient de créer un compte.' };
    case 'challenge:new':
      return { title: 'Défi reçu', body: `Nouveau défi de ${payload.from || 'un joueur'}` };
    case 'challenge:created':
      return { title: 'Défi envoyé', body: `Votre défi de ${payload.amount || 0} CFA a bien été envoyé.` };
    case 'admin:challenge_created':
      return { title: 'Défi créé', body: `Un défi de ${payload.amount || 0} CFA a été créé.` };
    case 'admin:challenge_cleanup':
      return { title: 'Défis nettoyés', body: `${payload.count || 0} défi(s) ouvert(s) ont été annulé(s).` };
    case 'challenge:accepted':
      return { title: 'Défi accepté', body: 'Votre défi a été accepté.' };
    case 'challenge:declined':
      return { title: 'Défi refusé', body: 'Votre défi a été refusé.' };
    case 'challenge:counter_offer':
      return { title: 'Contre-proposition reçue', body: `Nouveau montant proposé: ${payload.counterAmount || 0} CFA.` };
    case 'challenge:expired':
      return { title: 'Défi expiré', body: 'Le délai de réponse du défi est dépassé.' };
    case 'challenge:cancelled':
      return { title: 'Défi annulé', body: 'Le défi a été annulé par son auteur.' };
    case 'duel:stake_locked':
      return { title: 'Mise bloquée', body: `La mise de ${payload.amount || 0} CFA a été bloquée pour le duel.` };
    case 'duel:room_created':
      return { title: 'Salle créée', body: 'La salle de match est prête.', link: payload.link || '' };
    case 'admin:duel_room_created':
      return { title: 'Salle de duel', body: `Une salle de duel a été créée pour ${payload.amount || 0} CFA.` };
    case 'duel:room_joined':
      return { title: 'Salle rejointe', body: 'Un joueur a rejoint la salle du duel.' };
    case 'duel:proof_submitted':
      return { title: 'Preuve envoyée', body: 'Votre capture de fin de match a bien été envoyée.' };
    case 'duel:proof_received':
      return { title: 'Capture reçue', body: 'Votre adversaire a soumis sa preuve.' };
    case 'duel:processing':
      return { title: 'Duel en cours', body: 'Les preuves du duel sont en cours d analyse par le backend.' };
    case 'duel:analysis_started':
      return { title: 'Analyse OCR', body: 'Les deux captures ont été reçues. Analyse en cours.' };
    case 'duel:ocr_processed':
      return { title: 'Analyse terminee', body: 'L analyse OCR est terminee. Verdict en cours de confirmation.' };
    case 'duel:review_required':
      return { title: 'Revue duel', body: 'Le duel nécessite une vérification manuelle admin.' };
    case 'duel:result_pending':
      return { title: 'Résultat en attente', body: 'Le duel attend encore la deuxième preuve.' };
    case 'duel:finished':
      return { title: 'Verdict final', body: payload.winnerUsername ? `${payload.winnerUsername} gagne le duel.` : 'Le duel est terminé.' };
    case 'duel:dispute_opened':
      return { title: 'Litige ouvert', body: 'Le résultat nécessite une vérification admin.' };
    case 'duel:payment_released':
      return { title: 'Paiement effectué', body: 'Le paiement du duel a été effectué.' };
    case 'admin:duel_settled':
      return { title: 'Duel réglé', body: `Le duel ${payload.duelId || ''} a été payé.` };
    case 'security:profile_suspicious':
      return { title: 'Signal sécurité', body: 'Un changement sensible a été détecté sur votre compte.' };
    case 'security:withdrawal_suspicious':
      return { title: 'Retrait sous surveillance', body: 'Un retrait atypique nécessite une vérification.' };
    case 'security:deposit_suspicious':
      return { title: 'Dépôt sous surveillance', body: 'Un dépôt atypique nécessite une vérification.' };
    default:
      return {
        title: payload.title || 'Nouvelle notification',
        body: payload.body || '',
        link: payload.link || ''
      };
  }
}

async function persistNotification(userId, event, payload = {}) {
  if (!userId) return null;
  const content = buildNotificationContent(event, payload);
  const duelId = payload.duelId || payload.duel;
  const challengeId = payload.challengeId || payload.challenge;
  const link = content.link || payload.link || (duelId ? `/duels/${duelId}` : challengeId ? `/challenges/${challengeId}` : '');
  const publicType = mapDomainEventToPublicType(event);
  const priority =
    payload.priority && PRIORITY_ENUM.has(payload.priority)
      ? payload.priority
      : defaultPriorityForPublicType(publicType);
  return Notification.create({
    user: userId,
    type: publicType,
    domainEvent: event,
    title: content.title,
    body: content.body,
    link,
    metadata: payload,
    priority
  });
}

/**
 * Crée une notification personnalisée (ex. admin), persiste et pousse en temps réel.
 * @param {import('socket.io').Server | null} _io — ignoré ; utilise l’instance Socket déjà configurée.
 */
export async function createNotification(_io, { userId, type, title, message, data = {}, priority = 'normal', link = '' }) {
  if (!userId) throw new Error('userId requis');
  if (!NOTIFICATION_PUBLIC_TYPES.includes(type)) {
    throw new Error(`Type invalide. Valeurs: ${NOTIFICATION_PUBLIC_TYPES.join(', ')}`);
  }
  const pr = PRIORITY_ENUM.has(priority) ? priority : 'normal';
  const doc = await Notification.create({
    user: userId,
    type,
    domainEvent: null,
    title: title || 'Notification',
    body: message || '',
    link: link || '',
    metadata: data && typeof data === 'object' ? data : {},
    priority: pr
  });
  pushRealtimeNotification(userId, doc, type, data);
  return doc;
}

function pushRealtimeNotification(userId, doc, domainEventForPacket, payload) {
  if (!ioInstance || userId == null || userId === '') return;
  const room = userSocketRoom(userId);
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  ioInstance.to(room).emit('new_notification', serializePublicNotification(plain));
  ioInstance.to(room).emit('notification:created', {
    notification: plain,
    domainEvent: domainEventForPacket,
    payload: payload ?? plain.metadata ?? {},
    ts: Date.now()
  });
}

export async function notifyAdmins(event, payload = {}) {
  const admins = await User.find({ role: 'admin', isBanned: false }).select('_id');
  if (!admins.length) return [];
  return Promise.all(admins.map((admin) => notifyUser(admin._id, event, payload)));
}

export function setSocketServer(io) {
  ioInstance = io;
}

/** Room privée Socket.IO par utilisateur (spec: user_USER_ID). */
export function userSocketRoom(userId) {
  return `user_${String(userId)}`;
}

/** Émission temps réel vers la room utilisateur (tous les onglets connectés). */
export function emitToUser(userId, channel, data) {
  if (!ioInstance || userId == null || userId === '') return;
  ioInstance.to(userSocketRoom(userId)).emit(channel, data);
}

export async function notifyUser(userId, event, payload = {}) {
  let doc = null;
  try {
    doc = await persistNotification(userId, event, payload);
  } catch {
    doc = null;
  }
  if (!ioInstance || userId == null || userId === '') return;
  const room = userSocketRoom(userId);
  ioInstance.to(room).emit(event, payload);
  if (doc) {
    pushRealtimeNotification(userId, doc, event, payload);
  }
}

export async function notifyRoom(roomId, event, payload = {}) {
  if (!ioInstance || !roomId) return;
  ioInstance.to(`duel:${roomId}`).emit(event, payload);
}
