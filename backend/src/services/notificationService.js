import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';

let ioInstance = null;

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
      return { title: 'Litige duel', body: 'Un duel est passé en litige et nécessite votre intervention.' };
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
    case 'duel:analysis_started':
      return { title: 'Analyse OCR', body: 'Les deux captures ont été reçues. Analyse en cours.' };
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
  return Notification.create({
    user: userId,
    type: event,
    title: content.title,
    body: content.body,
    link,
    metadata: payload
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

export async function notifyUser(userId, event, payload = {}) {
  await persistNotification(userId, event, payload).catch(() => {});
  if (!ioInstance || !userId) return;
  ioInstance.to(`user:${userId}`).emit(event, payload);
}

export async function notifyRoom(roomId, event, payload = {}) {
  if (!ioInstance || !roomId) return;
  ioInstance.to(`duel:${roomId}`).emit(event, payload);
}
