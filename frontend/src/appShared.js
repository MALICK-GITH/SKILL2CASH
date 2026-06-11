export const WHATSAPP_GROUP_URL = 'https://chat.whatsapp.com/EL4j85SBKiIL7UI9NfeSAB';

export const REGISTER_USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,24}$/;
export const REGISTER_PHONE_PATTERN = /^[+\d][\d\s().-]{6,24}$/;

export function money(value) {
  return `${Number(value || 0).toLocaleString('fr-FR')} CFA`;
}

export function timeAgo(value) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return '';
  const diffMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (diffMinutes < 1) return 'à l’instant';
  if (diffMinutes < 60) return `${diffMinutes} min`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} j`;
}

export function moneyOrDash(value) {
  return Number.isFinite(Number(value)) ? money(value) : '0 CFA';
}

export function labelForStatus(status = '') {
  const labels = {
    online: 'En ligne',
    offline: 'Hors ligne',
    busy: 'Occupé',
    available: 'Disponible',
    pending: 'En attente',
    accepted: 'Accepté',
    declined: 'Refusé',
    expired: 'Expiré',
    active: 'Actif',
    analyzing: 'Analyse',
    waiting_player1_proof: 'Attente preuve J1',
    waiting_player2_proof: 'Attente preuve J2',
    finished: 'Terminé',
    dispute: 'Litige',
    under_review: 'Attente admin',
    approved: 'Validé',
    rejected: 'Rejeté',
    paid: 'Payé',
    success: 'Succès',
    failed: 'Échec',
    processing: 'Traitement',
    cancelled: 'Annulé'
  };
  return labels[status] || status || 'Inconnu';
}

export function labelForTransaction(type = '') {
  const labels = {
    deposit: 'Dépôt',
    withdraw: 'Retrait',
    challenge_lock: 'Mise bloquée',
    challenge_refund: 'Remboursement',
    duel_win: 'Victoire',
    duel_loss: 'Défaite',
    commission: 'Commission',
    admin_adjustment: 'Ajustement équipe'
  };
  return labels[type] || type.replaceAll('_', ' ');
}

export function labelForPlayerRank(rank = '') {
  const key = String(rank || '').trim().toLowerCase();
  if (!key) return 'Non classé';
  const map = {
    bronze: 'Bronze',
    silver: 'Argent',
    gold: 'Or',
    platinum: 'Platine',
    diamond: 'Diamant',
    master: 'Maître',
    grandmaster: 'Grand maître'
  };
  return map[key] || String(rank).trim();
}

export function toneForStatus(status = '') {
  if (['success', 'available', 'online', 'approved', 'finished', 'paid'].includes(status)) return 'success';
  if (['pending', 'analyzing', 'waiting_player1_proof', 'waiting_player2_proof', 'busy'].includes(status)) return 'warning';
  if (['rejected', 'declined', 'expired', 'dispute', 'failed', 'offline', 'cancelled'].includes(status)) return 'danger';
  return 'neutral';
}

export function toneClass(status) {
  return `pill pill--${toneForStatus(status)}`;
}

export function toDisplayName(user) {
  if (!user) return 'Joueur';
  return user.firstName || user.lastName
    ? [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
    : user.efootballUsername || user.username || 'Joueur';
}
