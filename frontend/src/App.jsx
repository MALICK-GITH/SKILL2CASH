/* @refresh reset */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import {
  Bell,
  Banknote,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  Crown,
  Gamepad2,
  History,
  LayoutDashboard,
  Loader2,
  LogOut,
  MessageSquare,
  Medal,
  RefreshCw,
  Search,
  Send,
  Shield,
  Trash2,
  Swords,
  Trophy,
  Upload,
  UserRound,
  Wallet,
  XCircle
} from 'lucide-react';
import { api, clearSession, getSocketUrl, getStoredUser, getToken, setSession } from './api.js';
import { AuthView } from './components/AuthView.jsx';
import { DashboardView } from './components/DashboardView.jsx';
import { HistoryView } from './components/HistoryView.jsx';
import { Landing } from './components/Landing.jsx';
import { LeaderboardView } from './components/LeaderboardView.jsx';
import { SupportView } from './components/SupportView.jsx';
import { TelegramSettings } from './components/TelegramSettings.jsx';
import { TelegramMiniAppLink } from './components/TelegramMiniAppLink.jsx';
import { OcrAnalysisPanel } from './components/OcrAnalysisPanel.jsx';
import './styles.css';

const DEFAULT_METHOD = 'wave';
const WHATSAPP_GROUP_URL = 'https://chat.whatsapp.com/EL4j85SBKiIL7UI9NfeSAB';
const MATCH_CAPTURE_TIPS = [
  'Capture nette au format PNG, JPG ou WEBP.',
  'Montre l’écran de fin de match complet avec le score en haut.',
  'Les deux noms des équipes doivent rester lisibles dans la barre supérieure.',
  'Évite les photos de téléphone, les filtres et le zoom.',
  'Ne coupe pas les bords de l’écran et garde les stats visibles si possible.'
];
const DEPOSIT_CAPTURE_TIPS = [
  'Capture nette au format PNG, JPG ou WEBP.',
  'Montre clairement le montant, la référence et le numéro.',
  'Évite les captures tronquées, floues ou trop compressées.'
];
const REGISTER_USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,24}$/;
const REGISTER_PHONE_PATTERN = /^[+\d][\d\s().-]{6,24}$/;
const APP_VIEWS = new Set(['home', 'play', 'wallet', 'deposit', 'withdraw', 'leaderboard', 'history', 'inbox', 'support', 'profile', 'room', 'admin', 'tg']);
const PUBLIC_VIEWS = new Set(['landing', 'auth']);

let notificationAudioContext = null;

function money(value) {
  return `${Number(value || 0).toLocaleString('fr-FR')} CFA`;
}

function timeAgo(value) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return '';
  const diffMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (diffMinutes < 1) return 'à l\'instant';
  if (diffMinutes < 60) return `${diffMinutes} min`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} j`;
}

function labelForStatus(status = '') {
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

function labelForTransaction(type = '') {
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

function labelForOcrVerificationStatus(status = '') {
  const key = String(status || '').trim().toLowerCase();
  const map = {
    pending: 'En attente',
    matched: 'Correspondance confirmée',
    processing: 'Analyse en cours',
    failed: 'Analyse en échec',
    manual_review: 'Contrôle manuel',
    review_required: 'Contrôle requis',
    ocr_matched: 'OCR validé',
    ocr_review_required: 'Contrôle OCR requis'
  };
  return map[key] || (key ? status : '—');
}

const NOTIFICATION_TYPE_LABELS = {
  'challenge:new': 'Nouveau défi',
  challenge_received: 'Défi reçu',
  challenge_accepted: 'Défi accepté',
  challenge_refused: 'Défi refusé',
  deposit_pending: 'Dépôt en attente',
  deposit_validated: 'Dépôt validé',
  ocr_started: 'Analyse OCR démarrée',
  ocr_completed: 'Analyse OCR terminée',
  'admin:deposit_pending': 'Dépôt — équipe (en attente)',
  'admin:deposit_reviewed': 'Dépôt — traité par l’équipe',
  'admin:withdrawal_pending': 'Retrait — équipe (en attente)',
  'admin:withdrawal_reviewed': 'Retrait — traité par l’équipe',
  'admin:duel_room_created': 'Duel — salle créée',
  'admin:duel_settled': 'Duel — clôturé',
  'admin:dispute_pending': 'Litige — en attente',
  'admin:dispute_resolved': 'Litige — résolu',
  'admin:challenge_created': 'Défi — création admin',
  'admin:challenge_cleanup': 'Défi — nettoyage',
  'duel:proof_received': 'Duel — preuve reçue',
  'duel:proof_submitted': 'Duel — preuve envoyée',
  match_result_validated: 'Résultat validé',
  payment_sent: 'Paiement envoyé',
  admin_alert: 'Alerte équipe',
  system_alert: 'Alerte système',
  security: 'Sécurité',
  notification: 'Notification'
};

function labelForNotificationType(type = '') {
  const key = String(type || '').trim();
  if (!key) return 'Général';
  if (NOTIFICATION_TYPE_LABELS[key]) return NOTIFICATION_TYPE_LABELS[key];
  return key
    .replace(/_/g, ' ')
    .replace(/:/g, ' — ');
}

function labelForPlayerRank(rank = '') {
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

function toneForStatus(status = '') {
  if (['success', 'available', 'online', 'approved', 'finished', 'paid'].includes(status)) return 'success';
  if (['pending', 'analyzing', 'waiting_player1_proof', 'waiting_player2_proof', 'busy'].includes(status)) return 'warning';
  if (['rejected', 'declined', 'expired', 'dispute', 'failed', 'offline', 'cancelled'].includes(status)) return 'danger';
  return 'neutral';
}

function toneClass(status) {
  return `pill pill--${toneForStatus(status)}`;
}

function fraudTone(score) {
  const normalized = Number(score || 0);
  if (normalized >= 70) return 'danger';
  if (normalized >= 40) return 'warning';
  return 'success';
}

function fraudPillClass(score) {
  return `pill pill--${fraudTone(score)}`;
}

function formatFraudFlags(flags) {
  if (!Array.isArray(flags)) return [];
  return flags
    .map((flag) => String(flag || '').trim().replaceAll('_', ' '))
    .filter(Boolean);
}

function disputeSignalSummary(duel) {
  if (!duel) return [];
  const signals = [];
  const reason = String(duel.disputeReason || duel.autoValidationReason || '').trim();
  if (reason) signals.push(reason);
  if (Number(duel.ocrConfidencePlayer1 || 0) > 0) signals.push(`OCR J1 ${Number(duel.ocrConfidencePlayer1 || 0)}%`);
  if (Number(duel.ocrConfidencePlayer2 || 0) > 0) signals.push(`OCR J2 ${Number(duel.ocrConfidencePlayer2 || 0)}%`);
  if (duel.ocrScorePlayer1) signals.push(`Score OCR J1 ${duel.ocrScorePlayer1}`);
  if (duel.ocrScorePlayer2) signals.push(`Score OCR J2 ${duel.ocrScorePlayer2}`);
  return signals;
}

function friendlyDisputeReason(reason = '') {
  const normalized = String(reason || '').trim();
  if (!normalized) return 'Le système n’a pas pu valider automatiquement ce duel.';

  const labels = {
    'Declared results do not match': 'Les deux joueurs ont déclaré des résultats différents.',
    'Les déclarations des deux joueurs ne concordent pas.': 'Les deux joueurs ont déclaré des résultats différents.',
    'OCR confidence below 68%': 'Confiance OCR insuffisante pour valider sans contrôle.',
    'OCR confidence below 85%': 'Confiance OCR insuffisante pour valider sans contrôle.',
    'Confiance OCR insuffisante (seuil 68 %).': 'Confiance OCR insuffisante pour valider sans contrôle.',
    'OCR score does not match declared score': 'Le score détecté ne correspond pas au score déclaré.',
    'Le score détecté par l’OCR ne correspond pas au score déclaré.': 'Le score détecté ne correspond pas au score déclaré.',
    'OCR did not detect both player usernames': 'L’OCR n’a pas détecté clairement les deux pseudos.',
    'Indices joueur insuffisants pour une validation automatique fiable.': 'Indices joueur insuffisants pour une validation automatique fiable.',
    'OCR probable winner does not match declared winner': 'Le vainqueur probable détecté ne correspond pas au vainqueur déclaré.',
    'Le vainqueur probable détecté par l’OCR ne correspond pas au vainqueur déclaré.': 'Le vainqueur probable détecté ne correspond pas au vainqueur déclaré.',
    'OCR did not detect enough player evidence': 'Indices joueur insuffisants pour une validation automatique fiable.',
    'Declared results and OCR match with high confidence': 'Les preuves sont cohérentes et peuvent être validées automatiquement.',
    'Les preuves et l’OCR concordent : validation automatique possible.': 'Les preuves sont cohérentes et peuvent être validées automatiquement.'
  };

  return labels[normalized] || normalized;
}

function downloadableText(value) {
  return String(value || '').trim();
}

function CaptureGuidelines({ title, tips }) {
  return (
    <div className="upload-tips">
      <strong>{title}</strong>
      <ul>
        {tips.map((tip) => <li key={tip}>{tip}</li>)}
      </ul>
    </div>
  );
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Impossible de lire le fichier'));
    reader.readAsDataURL(file);
  });
}

function estimateDataUrlBytes(dataUrl) {
  const base64 = String(dataUrl || '').split(',')[1] || '';
  return Math.ceil((base64.length * 3) / 4);
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Impossible de préparer la capture'));
    };
    image.src = url;
  });
}

async function prepareDepositScreenshot(file) {
  const originalDataUrl = await readFileAsDataUrl(file);
  if (estimateDataUrlBytes(originalDataUrl) <= 700 * 1024) {
    return originalDataUrl;
  }

  const image = await loadImageFromFile(file);
  const maxSide = 1800;
  const scale = Math.min(1, maxSide / Math.max(image.width || 1, image.height || 1));
  const width = Math.max(1, Math.round((image.width || 1) * scale));
  const height = Math.max(1, Math.round((image.height || 1) * scale));
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return originalDataUrl;

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);

  const mimeTypes = ['image/webp', 'image/jpeg'];
  const qualities = [0.9, 0.82, 0.74, 0.66];

  for (const mimeType of mimeTypes) {
    for (const quality of qualities) {
      const compressed = canvas.toDataURL(mimeType, quality);
      if (estimateDataUrlBytes(compressed) <= 700 * 1024) {
        return compressed;
      }
    }
  }

  return canvas.toDataURL('image/jpeg', 0.66);
}

function moneyOrDash(value) {
  return Number.isFinite(Number(value)) ? money(value) : '0 CFA';
}

function normalizeSocketNotification(n) {
  if (!n || !n._id) return null;
  return {
    _id: n._id,
    user: n.userId ? n.user,
    type: n.type,
    title: n.title,
    body: n.message ? n.body ? '',
    metadata: n.data && typeof n.data === 'object' ? n.data : n.metadata || {},
    isRead: Boolean(n.read ? n.isRead),
    priority: n.priority || 'medium',
    createdAt: n.createdAt,
    domainEvent: n.domainEvent
  };
}

function getNotificationDuelId(notification) {
  const metadata = notification?.metadata || notification?.data || {};
  return String(metadata.duelId || metadata.duel || '').trim();
}

function getNotificationChallengeId(notification) {
  const metadata = notification?.metadata || notification?.data || {};
  return String(metadata.challengeId || metadata.challenge || '').trim();
}

function toastToneClass(priority) {
  if (priority === 'urgent' || priority === 'high') return 'toast--danger';
  if (priority === 'medium') return 'toast--warn';
  if (priority === 'low' || priority === 'normal') return 'toast--info';
  return 'toast--success';
}

function playNotificationTone() {
  if (typeof window === 'undefined') return;

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  try {
    if (!notificationAudioContext) {
      notificationAudioContext = new AudioContext();
    }

    if (notificationAudioContext.state === 'suspended') {
      notificationAudioContext.resume().catch(() => { });
    }

    const oscillator = notificationAudioContext.createOscillator();
    const gain = notificationAudioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, notificationAudioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(660, notificationAudioContext.currentTime + 0.16);
    gain.gain.setValueAtTime(0.0001, notificationAudioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, notificationAudioContext.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, notificationAudioContext.currentTime + 0.22);
    oscillator.connect(gain);
    gain.connect(notificationAudioContext.destination);
    oscillator.start();
    oscillator.stop(notificationAudioContext.currentTime + 0.24);
  } catch {
    // Silent fallback if the browser blocks audio playback.
  }
}

function walletBalance(user) {
  return user?.wallet?.balanceAvailable ? user?.balanceAvailable ? 0;
}

function getRouteFromLocation(hasUser = false) {
  if (typeof window === 'undefined') return 'landing';

  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  const route = {
    view: 'landing',
    duelId: params.get('duel') || '',
    roomFocus: params.get('focus') || '',
    profileTargetId: params.get('target') || '',
    challengeTargetId: params.get('challenge') || ''
  };

  if (hasUser && APP_VIEWS.has(view)) {
    route.view = view;
    return route;
  }

  if (!hasUser && PUBLIC_VIEWS.has(view)) {
    route.view = view;
    return route;
  }

  route.view = hasUser ? 'home' : 'landing';
  return route;
}

function syncRouteToLocation(view, { duelId = '', roomFocus = '', profileTargetId = '', challengeTargetId = '' } = {}) {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  if (view === 'landing') {
    url.searchParams.delete('view');
    url.searchParams.delete('duel');
    url.searchParams.delete('focus');
    url.searchParams.delete('target');
    url.searchParams.delete('challenge');
  } else {
    url.searchParams.set('view', view);
    if (duelId) url.searchParams.set('duel', duelId); else url.searchParams.delete('duel');
    if (roomFocus) url.searchParams.set('focus', roomFocus); else url.searchParams.delete('focus');
    if (profileTargetId) url.searchParams.set('target', profileTargetId); else url.searchParams.delete('target');
    if (challengeTargetId) url.searchParams.set('challenge', challengeTargetId); else url.searchParams.delete('challenge');
  }
  window.history.pushState({ view, duelId, roomFocus, profileTargetId, challengeTargetId }, '', `${url.pathname}${url.search}${url.hash}`);
}

function toDisplayName(user) {
  if (!user) return 'Joueur';
  return user.efootballUsername || user.username || 'Joueur';
}

/** Nom affichable pour un dépôt (profil plateforme), distinct du pseudo eFootball. */
function senderNameFromAccount(user) {
  if (!user) return '';
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ? ').trim();
  if (full) return full;
  return user.username || user.efootballUsername || '';
}

function pageTitle(view) {
  const titles = {
    home: 'Accueil',
    play: 'Jouer',
    wallet: 'Portefeuille',
    deposit: 'Dépôt',
    withdraw: 'Retrait',
    leaderboard: 'Classement',
    history: 'Historique',
    inbox: 'Boîte de réception',
    profile: 'Profil',
    room: 'Salle de match',
    tg: 'Telegram',
    admin: 'Administration'
  };
  return titles[view] || 'SKILL2CASH';
}

function assistantGreetingForHour(hour) {
  if (hour >= 5 && hour < 12) return 'Bonjour';
  if (hour >= 12 && hour < 18) return 'Bon après-midi';
  if (hour >= 18 && hour < 23) return 'Bonsoir';
  return 'Salut';
}

function assistantQuickPrompts(user, view) {
  if (user?.role === 'admin') {
    if (view === 'admin') {
      return [
        'Litiges en attente',
        'Dépôts OCR à vérifier',
        'Retraits à traiter',
        'Voir les utilisateurs à risque',
        'Résumé admin du jour'
      ];
    }
    if (view === 'deposit') {
      return [
        'Dépôts en attente',
        'Comment valider un dépôt ?',
        'OCR dépôt expliqué',
        'Aides pour les preuves',
        'Résumé dépôts'
      ];
    }
    if (view === 'withdraw') {
      return [
        'Retraits en attente',
        'Comment traiter un retrait ?',
        'Méthodes de retrait',
        'Utilisateurs à surveiller',
        'Résumé retraits'
      ];
    }
    if (view === 'play' || view === 'room') {
      return [
        'Litiges duels',
        'Duel OCR expliqué',
        'Derniers duels',
        'Salles actives',
        'Résumé compétition'
      ];
    }
    return [
      'Résumé admin du jour',
      'Litiges en attente',
      'Dépôts OCR à vérifier',
      'Retraits à traiter',
      'Utilisateurs à risque'
    ];
  }

  if (view === 'deposit') {
    return [
      'Comment déposer ?',
      'OCR dépôt expliqué',
      'Que mettre en référence ?',
      'Pourquoi mon dépôt est en attente ?',
      'Voir mes dépôts'
    ];
  }

  if (view === 'withdraw') {
    return [
      'Comment retirer ?',
      'Quel numéro utiliser ?',
      'Mes retraits',
      'Méthodes disponibles',
      'Voir mon solde'
    ];
  }

  if (view === 'play' || view === 'room') {
    return [
      'Comment jouer ?',
      'Trouver un adversaire',
      'Comprendre l’OCR',
      'Mes derniers duels',
      'Où voir mon solde ?'
    ];
  }

  if (view === 'landing' || view === 'auth') {
    return [
      'Créer un compte',
      'Comment déposer ?',
      'Comment retirer ?',
      'Comment jouer ?',
      'Comprendre l’OCR'
    ];
  }

  return [
    'Comment déposer ?',
    'Comment jouer ?',
    'Où voir mon solde ?',
    'Mes derniers duels',
    'Trouver un adversaire'
  ];
}

function assistantWelcomeMessage(user, view) {
  const greeting = assistantGreetingForHour(new Date().getHours());
  const displayName = user?.firstName || user?.lastName
    ? [user.firstName, user.lastName].filter(Boolean).join(' ? ').trim()
    : user?.efootballUsername || user?.username || 'joueur';
  const suffix = user?.role === 'admin'
    ? 'Je peux t aider sur les litiges, les dépôts, les retraits et les actions admin.'
    : 'Je peux t aider sur le wallet, les duels, les dépôts et la navigation.';
  const viewSuffix = view === 'deposit'
    ? 'Sur cette page, je peux aussi t aider à préparer une preuve de dépôt cohérente avec l OCR.'
    : view === 'withdraw'
      ? 'Sur cette page, je peux t aider à préparer un retrait cohérent avec le numéro ou le wallet demandé.'
      : view === 'play'
        ? 'Sur cette page, je peux t aider à choisir un adversaire et à lancer un duel.'
        : '';
  return `${greeting} ${displayName}. ${suffix}${viewSuffix ? ` ${viewSuffix}` : ''}`;
}

function App() {
  const storedUser = getStoredUser();
  const [user, setUser] = useState(storedUser);
  const initialRoute = getRouteFromLocation(Boolean(storedUser));
  const [view, setView] = useState(() => initialRoute.view);
  const [authMode, setAuthMode] = useState('login');
  const [toast, setToast] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [socket, setSocket] = useState(null);
  const [unreadCount, setUnreadCount] = useState(() => Number(window.localStorage.getItem('sk2c:unreadCount') || 0));
  const [selectedDuelId, setSelectedDuelId] = useState(initialRoute.duelId);
  const [roomFocus, setRoomFocus] = useState(initialRoute.roomFocus);
  const [profileTarget, setProfileTarget] = useState(initialRoute.profileTargetId ? { _id: initialRoute.profileTargetId } : null);
  const [challengeTarget, setChallengeTarget] = useState(initialRoute.challengeTargetId ? { _id: initialRoute.challengeTargetId } : null);
  const [assistantOpen, setAssistantOpen] = useState(() => {
    try {
      const saved = window.localStorage.getItem('sk2c:assistantOpen');
      if (saved === '1' || saved === '0') return saved === '1';
    } catch { }
    // Default: keep the UI unobstructed on auth screens.
    return initialRoute.view !== 'auth';
  });
  const [assistantDraft, setAssistantDraft] = useState('');
  const [assistantMessages, setAssistantMessages] = useState([]);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState('');
  const assistantInputRef = useRef(null);
  const [realtimeToast, setRealtimeToast] = useState(null);
  const [bellRing, setBellRing] = useState(false);
  const [notifMenuOpen, setNotifMenuOpen] = useState(false);
  const [adminInboxItemId, setAdminInboxItemId] = useState('');
  const [notifPreview, setNotifPreview] = useState(() => {
    try {
      const saved = window.localStorage.getItem('sk2c:notifPreview');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [isStandaloneApp, setIsStandaloneApp] = useState(false);
  const notifMenuRef = useRef(null);
  const bellTimerRef = useRef(null);
  const realtimeToastTimerRef = useRef(null);

  const refresh = () => setRefreshTick((current) => current + 1);

  useEffect(() => {
    try {
      window.localStorage.setItem('sk2c:unreadCount', String(unreadCount || 0));
    } catch { }
  }, [unreadCount]);

  useEffect(() => {
    try {
      window.localStorage.setItem('sk2c:assistantOpen', assistantOpen ? '1' : '0');
    } catch { }
  }, [assistantOpen]);

  useEffect(() => {
    try {
      // Store only essential fields to avoid quota exceeded
      const minimal = (notifPreview || []).slice(0, 5).map((n) => ({
        _id: n._id,
        title: n.title,
        body: n.body?.slice(0, 100),
        type: n.type,
        isRead: n.isRead,
        createdAt: n.createdAt
      }));
      window.localStorage.setItem('sk2c:notifPreview', JSON.stringify(minimal));
    } catch (e) {
      // Quota exceeded or other storage error - clear and ignore
      try { window.localStorage.removeItem('sk2c:notifPreview'); } catch { }
    }
  }, [notifPreview]);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    setIsStandaloneApp(Boolean(standalone));

    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPromptEvent(event);
    };
    const onInstalled = () => {
      setInstallPromptEvent(null);
      setIsStandaloneApp(true);
      setToast('Application installée. Ouverture en mode mobile natif.');
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  function navigate(nextView) {
    syncRouteToLocation(nextView);
    setView(nextView);
    if (nextView !== 'room') {
      setSelectedDuelId(null);
      setRoomFocus('');
    }
    if (nextView !== 'admin') {
      setAdminInboxItemId('');
    }
    if (nextView !== 'profile') setProfileTarget(null);
  }

  function openRoom(duelId, focus = '') {
    setSelectedDuelId(duelId);
    setRoomFocus(focus);
    syncRouteToLocation('room', { duelId, roomFocus: focus });
    setView('room');
  }

  function openProfile(target) {
    setProfileTarget(target || null);
    syncRouteToLocation('profile', { profileTargetId: target?._id || '' });
    setView('profile');
  }

  function openChallengeTarget(target) {
    setChallengeTarget(target || null);
    syncRouteToLocation('play', { challengeTargetId: target?._id || '' });
    setView('play');
  }

  async function markNotificationRead(notificationId) {
    if (!notificationId) return;
    try {
      await api(`/notifications/${notificationId}/read`, { method: 'PATCH' });
    } catch {
      // Best effort only: navigation should still work if the read update fails.
    }
  }

  function focusNotificationTarget(notification) {
    const duelId = getNotificationDuelId(notification);
    const challengeId = getNotificationChallengeId(notification);
    const type = String(notification?.type || '').toLowerCase();
    const isAdminDispute = type === 'admin_alert' || type.startsWith('admin:');

    if (isAdminDispute && duelId && user?.role === 'admin') {
      setAdminInboxItemId(duelId);
      navigate('admin');
      return;
    }

    if (duelId) {
      openRoom(duelId, type === 'duel:proof_received' ? 'proofs' : '');
      return;
    }

    if (challengeId) {
      navigate('inbox');
      return;
    }

    navigate('inbox');
  }

  async function handleNotificationClick(notification) {
    if (!notification?._id) return;
    await markNotificationRead(notification._id);
    focusNotificationTarget(notification);
  }

  function handleSessionExpired() {
    clearSession();
    setUser(null);
    setSocket(null);
    setUnreadCount(0);
    setSelectedDuelId(null);
    setRoomFocus('');
    setProfileTarget(null);
    setChallengeTarget(null);
    setToast('Session expirée. Reconnecte-toi.');
    syncRouteToLocation('landing');
    setView('landing');
    setAssistantMessages([]);
    setAssistantDraft('');
    setAssistantError('');
  }

  useEffect(() => {
    const handlePopState = () => {
      const nextRoute = getRouteFromLocation(Boolean(user));
      setView(nextRoute.view);
      setSelectedDuelId(nextRoute.duelId || null);
      setRoomFocus(nextRoute.roomFocus);
      setProfileTarget(nextRoute.profileTargetId ? { _id: nextRoute.profileTargetId } : null);
      setChallengeTarget(nextRoute.challengeTargetId ? { _id: nextRoute.challengeTargetId } : null);
    };

    window.addEventListener('popstate', handlePopState);
    handlePopState();
    return () => window.removeEventListener('popstate', handlePopState);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    api('/auth/me')
      .then(({ user: freshUser }) => {
        setUser((current) => ({ ...current, ...freshUser }));
      })
      .catch(handleSessionExpired);
  }, [user?._id]);

  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }

    api('/notifications/unread-count')
      .then((data) => setUnreadCount(Number(data.count ? data.unreadCount ? 0)))
      .catch(() => { });
  }, [user, refreshTick]);

  useEffect(() => {
    if (!user) {
      setNotifPreview([]);
      return;
    }
    api('/notifications?limit=8')
      .then((data) => setNotifPreview(data.notifications || []))
      .catch(() => { });
  }, [user?._id, refreshTick]);

  useEffect(() => {
    if (!notifMenuOpen) return undefined;
    function onDocClick(e) {
      if (notifMenuRef.current && !notifMenuRef.current.contains(e.target)) {
        setNotifMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [notifMenuOpen]);

  useEffect(() => {
    if (!notifMenuOpen) return undefined;
    const onEscape = (event) => {
      if (event.key === 'Escape') setNotifMenuOpen(false);
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [notifMenuOpen]);

  useEffect(() => {
    if (!user) return undefined;

    const nextSocket = io(getSocketUrl(), {
      auth: { token: getToken() },
      transports: ['websocket', 'polling'],
      timeout: 10000,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 700,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.35
    });
    setSocket(nextSocket);

    const dispatchNotif = (name, detail) => {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    };

    nextSocket.on('notification:created', (packet) => {
      dispatchNotif('skill2cash:notification-created', packet);
    });
    nextSocket.on('new_notification', (n) => {
      if (!n?.read) {
        setUnreadCount((c) => c + 1);
      }
      playNotificationTone();
      setBellRing(true);
      window.clearTimeout(bellTimerRef.current);
      bellTimerRef.current = window.setTimeout(() => setBellRing(false), 800);
      setRealtimeToast({
        notification: n,
        title: n.title || 'Nouvelle alerte',
        message: n.message || '',
        priority: n.priority || 'medium'
      });
      window.clearTimeout(realtimeToastTimerRef.current);
      realtimeToastTimerRef.current = window.setTimeout(() => setRealtimeToast(null), 5200);
      setNotifPreview((prev) => {
        const row = normalizeSocketNotification(n);
        if (!row) return prev;
        const next = [row, ...prev.filter((item) => String(item._id) !== String(row._id))];
        return next.slice(0, 12);
      });
    });
    nextSocket.on('notification:read', (packet) => {
      if (packet?.userId && String(packet.userId) !== String(user?._id)) return;
      if (typeof packet?.unreadCount === 'number') {
        setUnreadCount(packet.unreadCount);
      }
      dispatchNotif('skill2cash:notification-read', packet);
    });
    nextSocket.on('notification:read_all', (packet) => {
      if (packet?.userId && String(packet.userId) !== String(user?._id)) return;
      if (typeof packet?.unreadCount === 'number') {
        setUnreadCount(packet.unreadCount);
      }
      dispatchNotif('skill2cash:notification-read-all', packet);
    });
    nextSocket.on('notification:cleared', (packet) => {
      if (packet?.userId && String(packet.userId) !== String(user?._id)) return;
      if (typeof packet?.unreadCount === 'number') {
        setUnreadCount(packet.unreadCount);
      }
      setNotifPreview([]);
      dispatchNotif('skill2cash:notification-cleared', packet);
    });
    nextSocket.on('notification:deleted', (packet) => {
      if (packet?.userId && String(packet.userId) !== String(user?._id)) return;
      if (typeof packet?.unreadCount === 'number') {
        setUnreadCount(packet.unreadCount);
      }
      if (packet?.id) {
        setNotifPreview((prev) => prev.filter((item) => String(item._id) !== String(packet.id)));
      }
    });

    const handleSocketRefresh = () => {
      refresh();
    };

    nextSocket.on('challenge:new', handleSocketRefresh);
    nextSocket.on('challenge:accepted', handleSocketRefresh);
    nextSocket.on('challenge:declined', handleSocketRefresh);
    nextSocket.on('challenge:counter_offer', handleSocketRefresh);
    nextSocket.on('challenge:expired', handleSocketRefresh);
    nextSocket.on('challenge:cancelled', handleSocketRefresh);
    nextSocket.on('username:change_approved', handleSocketRefresh);
    nextSocket.on('username:change_rejected', handleSocketRefresh);
    nextSocket.on('deposit:submitted', handleSocketRefresh);
    nextSocket.on('deposit:approved', handleSocketRefresh);
    nextSocket.on('deposit:rejected', handleSocketRefresh);
    nextSocket.on('deposit:ocr_matched', handleSocketRefresh);
    nextSocket.on('deposit:ocr_review_required', handleSocketRefresh);
    nextSocket.on('withdrawal:submitted', handleSocketRefresh);
    nextSocket.on('withdrawal:processing', handleSocketRefresh);
    nextSocket.on('withdrawal:review_required', handleSocketRefresh);
    nextSocket.on('withdrawal:approved', handleSocketRefresh);
    nextSocket.on('withdrawal:rejected', handleSocketRefresh);
    nextSocket.on('withdrawal:paid', handleSocketRefresh);
    nextSocket.on('deposit:ocr_processing', handleSocketRefresh);
    nextSocket.on('duel:room_created', handleSocketRefresh);
    nextSocket.on('duel:room_joined', handleSocketRefresh);
    nextSocket.on('duel:proof_submitted', handleSocketRefresh);
    nextSocket.on('duel:proof_received', handleSocketRefresh);
    nextSocket.on('duel:processing', handleSocketRefresh);
    nextSocket.on('duel:analysis_started', handleSocketRefresh);
    nextSocket.on('duel:ocr_processed', handleSocketRefresh);
    nextSocket.on('ocr_processed', handleSocketRefresh);
    nextSocket.on('duel_result', handleSocketRefresh);
    nextSocket.on('duel:review_required', handleSocketRefresh);
    nextSocket.on('duel:result_pending', handleSocketRefresh);
    nextSocket.on('duel:finished', handleSocketRefresh);
    nextSocket.on('duel:dispute_opened', handleSocketRefresh);
    nextSocket.on('duel:payment_released', handleSocketRefresh);
    nextSocket.on('admin:deposit_pending', handleSocketRefresh);
    nextSocket.on('admin:deposit_reviewed', handleSocketRefresh);
    nextSocket.on('admin:withdrawal_pending', handleSocketRefresh);
    nextSocket.on('admin:withdrawal_reviewed', handleSocketRefresh);
    nextSocket.on('admin:dispute_pending', handleSocketRefresh);
    nextSocket.on('admin:dispute_resolved', handleSocketRefresh);
    nextSocket.on('admin:challenge_created', handleSocketRefresh);
    nextSocket.on('admin:challenge_cleanup', handleSocketRefresh);
    nextSocket.on('admin:duel_room_created', handleSocketRefresh);
    nextSocket.on('admin:duel_settled', handleSocketRefresh);
    nextSocket.on('security:profile_suspicious', handleSocketRefresh);
    nextSocket.on('security:withdrawal_suspicious', handleSocketRefresh);
    nextSocket.on('wallet:updated', refresh);
    nextSocket.on('connect', () => {
      nextSocket.emit('notifications:sync', (data) => {
        if (data?.ok && typeof data.unreadCount === 'number') {
          setUnreadCount(data.unreadCount);
        }
      });
      refresh();
    });
    nextSocket.on('connect_error', (error) => {
      if (/auth|session|token/i.test(error.message || '')) {
        handleSessionExpired();
      } else {
        setToast('Connexion instable, reconnexion en cours…');
      }
    });

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearTimeout(bellTimerRef.current);
      window.clearTimeout(realtimeToastTimerRef.current);
      nextSocket.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      setSocket(null);
    };
  }, [user?._id]);

  async function installMobileApp() {
    if (!installPromptEvent) return;
    try {
      await installPromptEvent.prompt();
      await installPromptEvent.userChoice;
    } catch {
      setToast('Installation indisponible pour le moment.');
    } finally {
      setInstallPromptEvent(null);
    }
  }

  useEffect(() => {
    if (!user || view !== 'inbox') return;
    api('/notifications/read-all', { method: 'PATCH' })
      .then(() => setUnreadCount(0))
      .catch(() => { });
  }, [user, view]);

  useEffect(() => {
    if (!user) return;
    if (view === 'landing' || view === 'auth') return;
    refresh();
  }, [user?._id, view]);

  function logout() {
    clearSession();
    setUser(null);
    setSocket(null);
    setUnreadCount(0);
    setSelectedDuelId(null);
    setRoomFocus('');
    setProfileTarget(null);
    setChallengeTarget(null);
    syncRouteToLocation('landing');
    setView('landing');
    setAssistantMessages([]);
    setAssistantDraft('');
    setAssistantError('');
  }

  useEffect(() => {
    if (!assistantMessages.length) {
      setAssistantMessages([{
        role: 'assistant',
        content: assistantWelcomeMessage(user, view),
        suggestions: assistantQuickPrompts(user, view)
      }]);
    }
  }, [assistantMessages.length, user, view]);

  async function sendAssistantMessage(event) {
    event.preventDefault();
    const prompt = assistantDraft.trim();
    if (!prompt || assistantLoading) return;

    const nextMessages = [...assistantMessages, { role: 'user', content: prompt }];
    setAssistantMessages(nextMessages);
    setAssistantDraft('');
    setAssistantLoading(true);
    setAssistantError('');

    try {
      const assistantPath = user?.role === 'admin' ? '/assistant/admin/chat' : '/assistant/chat';
      const response = await api(assistantPath, {
        method: 'POST',
        body: {
          message: prompt,
          messages: nextMessages,
          view
        }
      });
      setAssistantMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: response.reply || 'Je n’ai pas de réponse pour le moment.',
          suggestions: Array.isArray(response.suggestions) ? response.suggestions : []
        }
      ]);
    } catch (error) {
      setAssistantError(error.message);
      setAssistantMessages((current) => [...current, { role: 'assistant', content: 'Je n’ai pas pu répondre maintenant. Réessaie dans un instant.' }]);
    } finally {
      setAssistantLoading(false);
    }
  }

  const navItems = useMemo(() => [
    { id: 'home', label: 'Accueil', icon: LayoutDashboard },
    { id: 'play', label: 'Jouer', icon: Gamepad2 },
    { id: 'wallet', label: 'Portefeuille', icon: Wallet },
    { id: 'inbox', label: 'Boîte', icon: Bell, badge: unreadCount },
    { id: 'profile', label: 'Profil', icon: UserRound }
  ], [unreadCount]);

  const content = (() => {
    if (!user && view === 'landing') {
      return <Landing onEnter={() => { setAuthMode('login'); syncRouteToLocation('auth'); setView('auth'); }} onRegister={() => { setAuthMode('register'); syncRouteToLocation('auth'); setView('auth'); }} />;
    }

    if (!user && view === 'tg') {
      return <TelegramMiniAppLink />;
    }

    if (!user && view === 'auth') {
      return (
        <AuthView
          mode={authMode}
          onModeChange={setAuthMode}
          onSuccess={(payload) => {
            setSession(payload);
            setUser(payload.user);
            const hasTelegramLinkPending = Boolean(window.sessionStorage.getItem('tg:initData'));
            if (hasTelegramLinkPending) {
              syncRouteToLocation('tg');
              setView('tg');
            } else {
              syncRouteToLocation('home');
              setView('home');
            }
            refresh();
          }}
          onBack={() => { syncRouteToLocation('landing'); setView('landing'); }}
        />
      );
    }

    if (!user) {
      return <Landing onEnter={() => { setAuthMode('login'); syncRouteToLocation('auth'); setView('auth'); }} onRegister={() => { setAuthMode('register'); syncRouteToLocation('auth'); setView('auth'); }} />;
    }

    return (
      <div className="app-shell">
        <aside className="app-sidebar">
          <button type="button" className="brand" onClick={() => navigate('home')}>
            <span className="brand-mark">S2C</span>
            <span className="brand-copy">
              <strong>SKILL2CASH</strong>
              <small>ouvrir → comprendre → jouer</small>
            </span>
          </button>

          <nav className="sidebar-nav" aria-label="Navigation principale">
            {navItems.map(({ id, label, icon: Icon, badge }) => (
              <button
                key={id}
                type="button"
                className={`nav-item ${view === id ? 'is-active' : ''}`}
                onClick={() => navigate(id)}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
                {badge > 0 && <b className="nav-badge">{badge}</b>}
              </button>
            ))}
            {user?.role === 'admin' && (
              <button type="button" className={`nav-item ${view === 'admin' ? 'is-active' : ''}`} onClick={() => navigate('admin')}>
                <Shield size={18} aria-hidden="true" />
                <span>Administration</span>
              </button>
            )}
          </nav>

          <div className="sidebar-card">
            <div>
              <strong>{toDisplayName(user)}</strong>
              <small>SK2C: {user.username}</small>
            </div>
            <a
              className="cta-link cta-link--sidebar"
              href={WHATSAPP_GROUP_URL}
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp communauté
            </a>
            <button type="button" className="ghost-button" onClick={logout}>
              <LogOut size={16} aria-hidden="true" />
              Sortir
            </button>
          </div>
        </aside>

        <div className="app-main">
          <header className="topbar">
            <div>
              <p className="eyebrow">SKILL2CASH</p>
              <h1>{pageTitle(view)}</h1>
            </div>
            <div className="topbar-actions">
              {!isStandaloneApp && installPromptEvent && (
                <button type="button" className="primary-button" onClick={() => { void installMobileApp(); }}>
                  Installer l'app
                </button>
              )}
              <button type="button" className="ghost-button" onClick={() => refresh()}>
                <RefreshCw size={16} aria-hidden="true" />
                Rafraîchir
              </button>
              <div className="notif-hub" ref={notifMenuRef}>
                <button
                  type="button"
                  className={`ghost-button notif-hub__trigger ${bellRing ? 'is-ringing' : ''}`}
                  aria-expanded={notifMenuOpen}
                  aria-haspopup="true"
                  onClick={() => setNotifMenuOpen((o) => !o)}
                >
                  <Bell size={16} aria-hidden="true" />
                  Boîte
                  {unreadCount > 0 && <span className="notif-hub__badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
                </button>
                {notifMenuOpen && (
                  <div className="notif-hub__dropdown" role="menu">
                    <div className="notif-hub__head">
                      <strong>Notifications</strong>
                      <button type="button" className="linkish" onClick={() => { setNotifMenuOpen(false); navigate('inbox'); }}>
                        Tout voir
                      </button>
                    </div>
                    <div className="notif-hub__list">
                      {notifPreview.length === 0 && <div className="notif-hub__empty">Aucune notification récente.</div>}
                      {notifPreview.map((item) => (
                        <button
                          key={item._id}
                          type="button"
                          className={`notif-hub__row ${item.isRead ? '' : 'is-unread'} notif-hub__row--${item.priority || 'medium'}`}
                          onClick={() => {
                            setNotifMenuOpen(false);
                            void handleNotificationClick(item);
                          }}
                        >
                          <span className="notif-hub__title">{item.title}</span>
                          <span className="notif-hub__msg">{item.body}</span>
                          <span className="notif-hub__meta">{timeAgo(item.createdAt)} · {labelForNotificationType(item.type)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <button type="button" className="ghost-button" onClick={logout}>
                <LogOut size={16} aria-hidden="true" />
                Déconnexion
              </button>
            </div>
          </header>

          <a
            className="mobile-community-cta"
            href={WHATSAPP_GROUP_URL}
            target="_blank"
            rel="noreferrer"
          >
            <span>
              <strong>WhatsApp communauté</strong>
              <small>Rejoins le groupe depuis ton téléphone</small>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </a>

          <main className="page-stack">
            {view === 'home' && (
              <DashboardView
                user={user}
                refreshTick={refreshTick}
                onGoPlay={() => navigate('play')}
                onGoDeposit={() => navigate('deposit')}
                onGoLeaderboard={() => navigate('leaderboard')}
                onGoHistory={() => navigate('history')}
              />
            )}
            {view === 'play' && (
              <PlayView
                user={user}
                refreshTick={refreshTick}
                initialTarget={challengeTarget}
                onOpenProfile={openProfile}
                onChallengeCreated={() => {
                  setChallengeTarget(null);
                  navigate('inbox');
                }}
              />
            )}
            {view === 'wallet' && (
              <WalletView
                refreshTick={refreshTick}
                onGoDeposit={() => navigate('deposit')}
                onGoWithdraw={() => navigate('withdraw')}
              />
            )}
            {view === 'deposit' && (
              <DepositView
                user={user}
                refreshTick={refreshTick}
                onSuccess={({ message }) => {
                  if (message) setToast(message);
                  refresh();
                  navigate('wallet');
                }}
                onBack={() => navigate('wallet')}
              />
            )}
            {view === 'withdraw' && (
              <WithdrawView
                refreshTick={refreshTick}
                onSuccess={() => {
                  refresh();
                  navigate('wallet');
                }}
                onBack={() => navigate('wallet')}
              />
            )}
            {view === 'leaderboard' && (
              <LeaderboardView user={user} refreshTick={refreshTick} />
            )}
            {view === 'history' && (
              <HistoryView user={user} refreshTick={refreshTick} />
            )}
            {view === 'inbox' && (
              <InboxView
                user={user}
                refreshTick={refreshTick}
                onOpenRoom={openRoom}
                onOpenProfile={openProfile}
                onReadAllComplete={() => {
                  setUnreadCount(0);
                  refresh();
                }}
                onUnreadCount={setUnreadCount}
              />
            )}
            {view === 'support' && (
              <SupportView
                user={user}
                refreshTick={refreshTick}
              />
            )}
            {view === 'profile' && (
              <ProfileView
                user={user}
                refreshTick={refreshTick}
                target={profileTarget}
                onOpenChallenge={openChallengeTarget}
                onGoAdmin={() => navigate('admin')}
                onUserUpdate={(nextUser) => setUser((current) => ({ ...current, ...nextUser }))}
              />
            )}
            {view === 'tg' && <TelegramMiniAppLink />}
            {view === 'room' && selectedDuelId && (
              <RoomView
                duelId={selectedDuelId}
                user={user}
                refreshTick={refreshTick}
                socket={socket}
                focus={roomFocus}
                onRefresh={refresh}
                onBack={() => navigate('inbox')}
              />
            )}
            {view === 'admin' && user?.role === 'admin' && (
              <AdminView
                refreshTick={refreshTick}
                onRefresh={refresh}
                focusInboxItemId={adminInboxItemId}
              />
            )}
          </main>
        </div>

        <nav className="bottom-nav" aria-label="Navigation mobile">
          {navItems.map(({ id, label, icon: Icon, badge }) => (
            <button
              key={id}
              type="button"
              className={`bottom-nav-item ${view === id ? 'is-active' : ''}`}
              onClick={() => navigate(id)}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
              {badge > 0 && <b>{badge}</b>}
            </button>
          ))}
        </nav>
      </div>
    );
  })();

  return (
    <main className={`app-root view-${view}`}>
      {realtimeToast && (
        <button
          type="button"
          className={`toast toast--realtime ${toastToneClass(realtimeToast.priority)}`}
          onClick={() => {
            void handleNotificationClick(realtimeToast.notification);
            setRealtimeToast(null);
          }}
        >
          <Bell size={16} aria-hidden="true" />
          <span>
            <strong>{realtimeToast.title}</strong>
            {realtimeToast.message ? <small>{realtimeToast.message}</small> : null}
          </span>
        </button>
      )}
      {toast && !realtimeToast && (
        <button type="button" className="toast" onClick={() => setToast('')}>
          <Bell size={16} aria-hidden="true" />
          <span>{toast}</span>
        </button>
      )}
      <aside className={`assistant-panel ${assistantOpen ? 'is-open' : 'is-collapsed'}`} aria-label="Assistant conversationnel">
        <button type="button" className="assistant-launcher" onClick={() => setAssistantOpen((current) => !current)}>
          <MessageSquare size={16} aria-hidden="true" />
          <span>Aide</span>
          <small>{assistantOpen ? 'Réduire' : 'Ouvrir'}</small>
        </button>

        {assistantOpen && (
          <div className="assistant-window">
            <div className="assistant-header">
              <div>
                <strong>Assistant SKILL2CASH</strong>
                <small>{view === 'landing' ? 'Aide publique' : `Contexte : ${pageTitle(view)}`}</small>
              </div>
              <button type="button" className="assistant-close" onClick={() => setAssistantOpen(false)}>
                <XCircle size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="assistant-quick-actions">
              {assistantQuickPrompts(user, view).map((prompt) => (
                <button key={prompt} type="button" className="assistant-quick-chip" onClick={() => setAssistantDraft(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>

            <div className="assistant-log">
              {assistantMessages.map((item, index) => (
                <div key={`${item.role}-${index}`} className={`assistant-bubble assistant-bubble--${item.role}`}>
                  <div className="assistant-bubble-content">{item.content}</div>
                  {item.role === 'assistant' && Array.isArray(item.suggestions) && item.suggestions.length > 0 && (
                    <div className="assistant-bubble-actions">
                      {item.suggestions.map((prompt) => (
                        <button
                          key={`${prompt}-${index}`}
                          type="button"
                          className="assistant-quick-chip"
                          onClick={() => {
                            setAssistantDraft(prompt);
                            assistantInputRef.current?.focus();
                          }}
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {assistantLoading && <div className="assistant-bubble assistant-bubble--assistant">Réflexion en cours...</div>}
            </div>

            {assistantError && <p className="assistant-error">{assistantError}</p>}

            <form className="assistant-form" onSubmit={sendAssistantMessage}>
              <input
                ref={assistantInputRef}
                value={assistantDraft}
                onChange={(event) => setAssistantDraft(event.target.value)}
                placeholder="Pose ta question..."
              />
              <button type="submit" className="primary-button" disabled={assistantLoading}>
                <Send size={16} aria-hidden="true" />
              </button>
            </form>
          </div>
        )}
      </aside>
      {content}
    </main>
  );
}

function PlayView({ user, refreshTick, initialTarget, onOpenProfile, onChallengeCreated }) {
  const PAGE_SIZE = 100;
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(initialTarget || null);
  const [stake, setStake] = useState('');
  const [rules, setRules] = useState('Match standard 10 min, capture d’écran de fin obligatoire.');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();

  useEffect(() => {
    if (initialTarget) {
      setSelected(initialTarget);
    }
  }, [initialTarget?._id]);

  useEffect(() => {
    let active = true;
    const handle = setTimeout(() => {
      setLoading(true);
      setPlayers([]);
      setError('');

      (async () => {
        try {
          const aggregated = [];
          let page = 1;
          let keepFetching = true;

          while (keepFetching && active) {
            const params = new URLSearchParams();
            if (query.trim()) params.set('q', query.trim());
            params.set('excludeId', user._id);
            params.set('limit', String(PAGE_SIZE));
            params.set('page', String(page));

            // Pull every page so the player list is effectively unlimited on the client.
            const data = await api(`/users/search?${params.toString()}`);
            const nextPlayers = data.users || [];
            aggregated.push(...nextPlayers);
            keepFetching = nextPlayers.length === PAGE_SIZE;
            page += 1;
          }

          if (!active) return;
          setPlayers(aggregated);
        } catch (err) {
          if (!active) return;
          setError(err.message);
        } finally {
          if (active) setLoading(false);
        }
      })();
    }, 250);

    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [query, refreshTick, user._id]);

  const visiblePlayers = useMemo(() => {
    if (!normalizedQuery) return players;
    return players.filter((player) => {
      const haystack = [
        player.username,
        player.efootballUsername,
        toDisplayName(player),
        player.country
      ]
        .filter(Boolean)
        .join(' ? ')
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [players, normalizedQuery]);

  async function submitChallenge(event) {
    event.preventDefault();
    if (!selected?._id) return;

    setSubmitting(true);
    setError('');
    try {
      await api('/challenges', {
        method: 'POST',
        body: {
          challengedId: selected._id,
          amount: Number(stake),
          rules,
          message,
          matchType: 'eFootball 1v1'
        }
      });
      setSelected(null);
      setStake('');
      setMessage('');
      setRules('Match standard 10 min, capture d’écran de fin obligatoire.');
      onChallengeCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="page-stack">
      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Action rapide</p>
            <h2>Trouver un adversaire</h2>
          </div>
          <span className={toneClass('available')}>Prêt</span>
        </div>

        <div className="filter-row">
          <label className="search-field">
            <Search size={16} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher par pseudo eFootball" />
          </label>
        </div>
      </div>

      <div className="player-grid">
        {loading && (
          <div className="empty-card">
            <Loader2 className="spin" size={18} aria-hidden="true" />
            Chargement des joueurs...
          </div>
        )}
        {visiblePlayers.map((player) => (
          <article key={player._id} className={`player-card ${selected?._id === player._id ? 'is-selected' : ''}`}>
            <div>
              <strong>{toDisplayName(player)}</strong>
              <small>SK2C: {player.username}</small>
            </div>
            <div className="player-meta">
              <small>{player.wins || 0} victoires</small>
              <small>{player.losses || 0} défaites</small>
            </div>
            <div className="inline-actions">
              <button type="button" className="secondary-button" onClick={() => onOpenProfile(player)}>
                Profil
              </button>
              <button type="button" className="primary-button" onClick={() => setSelected(player)}>
                Défier
              </button>
            </div>
          </article>
        ))}
        {!loading && visiblePlayers.length === 0 && (
          <div className="empty-card">
            Aucun joueur trouvé.
          </div>
        )}
      </div>

      {selected && (
        <form className="panel form-panel" onSubmit={submitChallenge}>
          <div className="panel-head">
            <div>
              <p className="eyebrow">Créer un défi</p>
              <h2>{toDisplayName(selected)}</h2>
            </div>
            <button type="button" className="ghost-button" onClick={() => setSelected(null)}>
              Fermer
            </button>
          </div>

          <label>
            Montant de la mise
            <input type="number" min="1" value={stake} onChange={(event) => setStake(event.target.value)} placeholder="Ex: 5000" required />
          </label>

          <label>
            Règles du match
            <textarea value={rules} onChange={(event) => setRules(event.target.value)} rows="3" required />
          </label>

          <label>
            Message optionnel
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows="2" placeholder="Bonne chance !" />
          </label>

          {error && <p className="error">{error}</p>}
          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
            Envoyer le défi
          </button>
        </form>
      )}
    </section>
  );
}

function WalletView({ refreshTick, onGoDeposit, onGoWithdraw }) {
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(!loadedOnce);

    Promise.all([
      api('/wallet'),
      api('/wallet/transactions?limit=10')
    ])
      .then(([walletData, txData]) => {
        if (!active) return;
        setWallet(walletData.wallet);
        setTransactions(txData.transactions || []);
        setLoadedOnce(true);
      })
      .catch(() => { })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [refreshTick, loadedOnce]);

  return (
    <section className="page-stack">
      <div className="metric-grid">
        <article className="metric-card">
          <span>Disponible</span>
          <strong>{loading && !loadedOnce ? '...' : moneyOrDash(wallet?.balanceAvailable)}</strong>
        </article>
        <article className="metric-card">
          <span>Bloqué</span>
          <strong>{loading && !loadedOnce ? '...' : moneyOrDash(wallet?.balanceLocked)}</strong>
        </article>
        <article className="metric-card metric-card--accent">
          <span>Total</span>
          <strong>{loading && !loadedOnce ? '...' : moneyOrDash(wallet?.balanceTotal)}</strong>
        </article>
      </div>

      <div className="shortcut-grid">
        <button type="button" className="shortcut-card" onClick={onGoDeposit}>
          <Wallet size={18} aria-hidden="true" />
          <span>Déposer</span>
          <small>Wave / MTN</small>
        </button>
        <button type="button" className="shortcut-card" onClick={onGoWithdraw}>
          <Banknote size={18} aria-hidden="true" />
          <span>Retirer</span>
          <small>Validation équipe</small>
        </button>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Transactions</p>
            <h2>Activité récente</h2>
          </div>
        </div>
        <div className="list-stack">
          {transactions.map((transaction) => (
            <article key={transaction._id} className="list-row">
              <div>
                <strong>{labelForTransaction(transaction.type)}</strong>
                <small>{transaction.description || 'Mouvement'}</small>
              </div>
              <div className="row-meta">
                <strong>{moneyOrDash(transaction.amount)}</strong>
                <span className={toneClass(transaction.status)}>{labelForStatus(transaction.status)}</span>
              </div>
            </article>
          ))}
          {!loading && transactions.length === 0 && <div className="empty-card">Aucune transaction.</div>}
        </div>
      </div>
    </section>
  );
}

function DepositView({ user, refreshTick, onSuccess, onBack }) {
  const [wallet, setWallet] = useState(null);
  const [method, setMethod] = useState(DEFAULT_METHOD);
  const [form, setForm] = useState({
    amount: '',
    senderName: senderNameFromAccount(user),
    senderPhone: '',
    transactionReference: '',
    screenshotUrl: ''
  });
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [prefilling, setPrefilling] = useState(false);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(!loadedOnce);
    api('/wallet')
      .then((data) => {
        if (!active) return;
        setWallet(data);
        setLoadedOnce(true);
      })
      .catch(() => { })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [refreshTick, loadedOnce]);

  useEffect(() => {
    const fromProfile = senderNameFromAccount(user);
    if (!fromProfile) return;
    setForm((current) => ({
      ...current,
      senderName: current.senderName?.trim() ? current.senderName : fromProfile
    }));
  }, [user?._id, user?.firstName, user?.lastName, user?.username]);

  const account = wallet?.paymentAccounts?.[method];

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await prepareDepositScreenshot(file);
      setForm((current) => ({ ...current, screenshotUrl: dataUrl }));
      setError('');
      setPrefilling(true);
      setStatusMessage('Analyse OCR de la capture en cours...');
      const prefill = await api('/wallet/deposit/ocr-prefill', {
        method: 'POST',
        body: {
          method,
          screenshotUrl: dataUrl
        },
        timeoutMs: 30000
      });
      const fields = prefill?.fields || {};
      if (fields.method && ['wave', 'mtn'].includes(String(fields.method))) {
        setMethod(String(fields.method));
      }
      setForm((current) => ({
        ...current,
        amount: fields.amount ? String(fields.amount) : current.amount,
        senderName: fields.senderName || current.senderName,
        senderPhone: fields.senderPhone || current.senderPhone,
        transactionReference: fields.transactionReference || current.transactionReference,
        screenshotUrl: dataUrl
      }));
      const manual = Array.isArray(prefill?.manualFields) ? prefill.manualFields : [];
      if (manual.includes('senderPhone')) {
        setStatusMessage(
          'Montant et référence préremplis depuis le reçu. Ton nom expéditeur est repris depuis ton profil SKILL2CASH (tu peux le corriger si besoin). Saisis le numéro d’expéditeur utilisé pour payer, puis vérifie avant d’envoyer.'
        );
      } else {
        setStatusMessage('Champs préremplis automatiquement depuis la capture. Vérifie puis confirme.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPrefilling(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setStatusMessage('');

    try {
      const response = await api('/wallet/deposit', {
        method: 'POST',
        body: {
          method,
          amount: Number(form.amount),
          senderName: form.senderName,
          senderPhone: form.senderPhone,
          transactionReference: form.transactionReference,
          screenshotUrl: form.screenshotUrl
        }
      });
      const ocrStatus = response?.deposit?.autoVerificationStatus;
      const message = ocrStatus === 'matched'
        ? 'Dépôt reçu. Analyse OCR en cours — validation automatique possible.'
        : 'Dépôt reçu. Analyse OCR en cours par la plateforme.';
      setStatusMessage(message);
      onSuccess({ message, deposit: response?.deposit || null });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="page-stack">
      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Dépôt</p>
            <h2>Envoyer de l'argent</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onBack}>
            Retour
          </button>
        </div>

        <div className="method-tabs">
          {Object.values(wallet?.paymentAccounts || {}).map((entry) => (
            <button
              key={entry.method}
              type="button"
              className={method === entry.method ? 'tab is-active' : 'tab'}
              onClick={() => setMethod(entry.method)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {loading && !loadedOnce && <div className="empty-card"><Loader2 size={16} className="spin" aria-hidden="true" /> Chargement en cours…</div>}
        {account && (
          <div className="instructions-card">
            <strong>{account.accountName}</strong>
            <p className="mono">{account.paymentNumber}</p>
            <small>Délais estimés: {account.estimatedDelay}</small>
            <ul>
              {account.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}
            </ul>
          </div>
        )}
      </div>

      <form className="panel form-panel" onSubmit={submit}>
        <label>
          Montant envoyé
          <input type="number" min="1" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} required />
        </label>
        <label>
          Numéro expéditeur
          <input value={form.senderPhone} onChange={(event) => setForm((current) => ({ ...current, senderPhone: event.target.value }))} required />
        </label>
        <label>
          Nom expéditeur
          <input value={form.senderName} onChange={(event) => setForm((current) => ({ ...current, senderName: event.target.value }))} required />
        </label>
        <label>
          Référence transaction (optionnel)
          <input
            value={form.transactionReference}
            onChange={(event) => setForm((current) => ({ ...current, transactionReference: event.target.value }))}
            placeholder="Laisse vide si non disponible"
          />
        </label>
        <label>
          Capture du paiement
          <input type="file" accept="image/*" onChange={handleFile} required />
        </label>

        <CaptureGuidelines title="Conseils pour la capture" tips={DEPOSIT_CAPTURE_TIPS} />

        {form.screenshotUrl && (
          <img className="proof-preview" src={form.screenshotUrl} alt="Prévisualisation de la capture de paiement" />
        )}
        {statusMessage && <p className="success">{statusMessage}</p>}
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary-button" disabled={submitting || prefilling}>
          {submitting || prefilling ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
          Soumettre le dépôt
        </button>
        <p className="muted">Le portefeuille n’est crédité qu’après validation par la plateforme. Les preuves douteuses restent en attente de l’équipe.</p>
      </form>
    </section>
  );
}

function WithdrawView({ refreshTick, onSuccess, onBack }) {
  const [wallet, setWallet] = useState(null);
  const [form, setForm] = useState({
    amount: '',
    method: 'wave',
    phoneOrWallet: ''
  });
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(!loadedOnce);
    api('/wallet')
      .then((data) => {
        if (!active) return;
        setWallet(data.wallet);
        setLoadedOnce(true);
      })
      .catch(() => { })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [refreshTick, loadedOnce]);

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      await api('/wallet/withdraw', {
        method: 'POST',
        body: {
          amount: Number(form.amount),
          method: form.method,
          phoneOrWallet: form.phoneOrWallet
        }
      });
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="page-stack">
      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Retrait</p>
            <h2>Retirer vers un compte</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onBack}>
            Retour
          </button>
        </div>
        <div className="metric-grid">
          <article className="metric-card">
            <span>Disponible</span>
            <strong>{loading && !loadedOnce ? '...' : moneyOrDash(wallet?.balanceAvailable)}</strong>
          </article>
          <article className="metric-card">
            <span>Bloqué</span>
            <strong>{loading && !loadedOnce ? '...' : moneyOrDash(wallet?.balanceLocked)}</strong>
          </article>
        </div>
      </div>

      <form className="panel form-panel" onSubmit={submit}>
        <label>
          Montant
          <input type="number" min="1" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} required />
        </label>
        <label>
          Méthode
          <select value={form.method} onChange={(event) => setForm((current) => ({ ...current, method: event.target.value }))}>
            <option value="wave">Wave</option>
            <option value="mtn">MTN Mobile Money</option>
            <option value="Mobile Money">Autre Mobile Money</option>
          </select>
        </label>
        <label>
          Numéro de réception
          <input value={form.phoneOrWallet} onChange={(event) => setForm((current) => ({ ...current, phoneOrWallet: event.target.value }))} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary-button" disabled={submitting}>
          {submitting ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Banknote size={16} aria-hidden="true" />}
          Soumettre le retrait
        </button>
        <p className="muted">Le retrait est mis en attente. L’équipe le valide ou le rejette ; aucune double validation n’est possible.</p>
      </form>
    </section>
  );
}

function InboxView({ user, refreshTick, onOpenRoom, onOpenProfile, onReadAllComplete, onUnreadCount }) {
  const [notifications, setNotifications] = useState([]);
  const [incomingChallenges, setIncomingChallenges] = useState([]);
  const [duels, setDuels] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [selectedNotificationId, setSelectedNotificationId] = useState('');
  const [notificationFilter, setNotificationFilter] = useState('all');
  const [notificationQuery, setNotificationQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    function onCreated(event) {
      const { notification } = event.detail || {};
      if (!notification?._id) return;
      setNotifications((prev) => {
        if (prev.some((item) => String(item._id) === String(notification._id))) return prev;
        return [notification, ...prev].slice(0, 40);
      });
    }
    function onRead(event) {
      const { notification, id } = event.detail || {};
      const nid = id || notification?._id;
      if (!nid) return;
      setNotifications((prev) => prev.map((item) => (String(item._id) === String(nid) ? { ...item, isRead: true, readAt: notification?.readAt || item.readAt } : item)));
    }
    function onReadAll() {
      setNotifications((prev) => prev.map((item) => ({ ...item, isRead: true })));
    }
    function onCleared() {
      setNotifications([]);
      setSelectedNotificationId('');
    }
    window.addEventListener('skill2cash:notification-created', onCreated);
    window.addEventListener('skill2cash:notification-read', onRead);
    window.addEventListener('skill2cash:notification-read-all', onReadAll);
    window.addEventListener('skill2cash:notification-cleared', onCleared);
    return () => {
      window.removeEventListener('skill2cash:notification-created', onCreated);
      window.removeEventListener('skill2cash:notification-read', onRead);
      window.removeEventListener('skill2cash:notification-read-all', onReadAll);
      window.removeEventListener('skill2cash:notification-cleared', onCleared);
    };
  }, []);

  useEffect(() => {
    Promise.all([
      api('/notifications?limit=40'),
      api('/challenges/incoming'),
      api('/duels'),
      api('/wallet'),
      api('/wallet/deposits'),
      api('/wallet/withdrawals')
    ])
      .then(([notificationData, challengeData, duelData, walletData, depositData, withdrawalData]) => {
        setNotifications(notificationData.notifications || []);
        setIncomingChallenges(challengeData.challenges || []);
        setDuels(duelData.duels || []);
        setWallet({
          ...(walletData || {}),
          deposits: depositData.deposits || walletData?.deposits || [],
          withdrawals: withdrawalData.withdrawals || walletData?.withdrawals || []
        });
      })
      .catch(() => { });
  }, [refreshTick]);

  const selectedNotification = notifications.find((item) => String(item._id) === String(selectedNotificationId)) || null;
  const selectedMetadata = selectedNotification?.metadata || {};
  const selectedDuelId = selectedMetadata.duelId || selectedMetadata.duel;
  const selectedChallengeId = selectedMetadata.challengeId || selectedMetadata.challenge;
  const selectedDeposit = wallet?.deposits?.find((deposit) => String(deposit._id) === String(selectedMetadata.depositId || selectedMetadata.deposit)) || null;
  const selectedWithdrawal = wallet?.withdrawals?.find((withdrawal) => String(withdrawal._id) === String(selectedMetadata.withdrawalId || selectedMetadata.withdrawal)) || null;
  const selectedDuel = duels.find((duel) => String(duel._id) === String(selectedDuelId)) || null;

  function markNotificationRead(id) {
    setNotifications((current) => current.map((item) => (item._id === id ? { ...item, isRead: true } : item)));
  }

  async function openNotification(item) {
    setError('');
    try {
      await api(`/notifications/${item._id}/read`, { method: 'PATCH' });
      markNotificationRead(item._id);
      setSelectedNotificationId(item._id);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }

  async function deleteNotification(id, event) {
    if (event) event.stopPropagation();
    setError('');
    try {
      const res = await api(`/notifications/${id}`, { method: 'DELETE' });
      setNotifications((current) => current.filter((item) => String(item._id) !== String(id)));
      if (String(selectedNotificationId) === String(id)) setSelectedNotificationId('');
      if (typeof res?.unreadCount === 'number') onUnreadCount?.(res.unreadCount);
    } catch (err) {
      setError(err.message);
    }
  }

  async function clearAllNotifications() {
    setError('');
    try {
      const res = await api('/notifications/clear-all', { method: 'DELETE' });
      setNotifications([]);
      setSelectedNotificationId('');
      onUnreadCount?.(Number(res?.unreadCount ? 0));
    } catch (err) {
      setError(err.message);
    }
  }

  function filterNotification(item) {
    const categoryMap = {
      deposit: [
        'deposit',
        'deposit_pending',
        'deposit_validated',
        'ocr_started',
        'ocr_completed',
        'admin:deposit_pending',
        'admin:deposit_reviewed'
      ],
      withdrawal: ['withdrawal', 'admin:withdrawal_pending', 'admin:withdrawal_reviewed'],
      duel: [
        'duel',
        'match_result_validated',
        'payment_sent',
        'admin:duel_room_created',
        'admin:duel_settled',
        'admin:dispute_pending',
        'admin:dispute_resolved'
      ],
      challenge: ['challenge', 'challenge_received', 'challenge_accepted', 'challenge_refused', 'admin:challenge_created', 'admin:challenge_cleanup'],
      security: ['security', 'admin_alert', 'system_alert']
    };
    const normalizedQuery = notificationQuery.trim().toLowerCase();
    const type = String(item.type || '').toLowerCase();
    const body = String(item.body || '').toLowerCase();
    const title = String(item.title || '').toLowerCase();
    const actor = String(item.metadata?.actor?.username || item.metadata?.actor?.efootballUsername || item.metadata?.username || '').toLowerCase();
    const amount = String(item.metadata?.amount ? '').toLowerCase();
    const categoryOk = notificationFilter === 'all'
      ? true
      : notificationFilter === 'unread'
        ? !item.isRead
        : (categoryMap[notificationFilter] || []).some((prefix) => type.startsWith(prefix));
    const queryOk = !normalizedQuery
      || title.includes(normalizedQuery)
      || body.includes(normalizedQuery)
      || type.includes(normalizedQuery)
      || actor.includes(normalizedQuery)
      || amount.includes(normalizedQuery);
    return categoryOk && queryOk;
  }

  async function openSelectedRoom() {
    if (selectedDuelId) {
      onOpenRoom(selectedDuelId, selectedNotification?.type === 'duel:proof_received' ? 'proofs' : '');
      return;
    }

    if (selectedChallengeId) {
      const linkedDuel = duels.find((duel) => String(duel.challenge?._id || duel.challenge) === String(selectedChallengeId));
      if (linkedDuel?._id) onOpenRoom(linkedDuel._id);
    }
  }

  async function acceptChallenge(id) {
    try {
      const data = await api(`/challenges/${id}/accept`, { method: 'POST' });
      setIncomingChallenges((current) => current.filter((item) => item._id !== id));
      if (data.duel?._id) onOpenRoom(data.duel._id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function declineChallenge(id) {
    try {
      await api(`/challenges/${id}/decline`, { method: 'POST' });
      setIncomingChallenges((current) => current.filter((item) => item._id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  async function counterChallenge(id) {
    try {
      const rawValue = window.prompt('Montant de contre-proposition', '');
      if (rawValue === null) return;
      const counterAmount = Number(rawValue);
      if (!Number.isFinite(counterAmount) || counterAmount <= 0) {
        setError('Le montant de contre-proposition doit être un nombre positif.');
        return;
      }

      await api(`/challenges/${id}/counter`, {
        method: 'POST',
        body: { counterAmount }
      });
      setIncomingChallenges((current) => current.filter((item) => item._id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  const activeDuels = duels.filter((duel) => ['active', 'waiting_player1_proof', 'waiting_player2_proof', 'analyzing', 'dispute'].includes(duel.status));
  const filteredNotifications = notifications.filter(filterNotification);
  const selectedDepositScreenshot = selectedDeposit?.screenshotUrl || selectedNotification?.metadata?.screenshotUrl || '';

  const bestDuelByChallengeId = useMemo(() => {
    const statusWeight = {
      active: 5,
      waiting_player1_proof: 4,
      waiting_player2_proof: 4,
      analyzing: 3,
      dispute: 3,
      finished: 2,
      cancelled: 1
    };
    const sorted = [...duels].sort((a, b) => {
      const sa = statusWeight[a?.status] || 0;
      const sb = statusWeight[b?.status] || 0;
      if (sa !== sb) return sb - sa;
      return new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime();
    });
    const map = new Map();
    sorted.forEach((duel) => {
      const challengeId = String(duel?.challenge?._id || duel?.challenge || '').trim();
      if (!challengeId || map.has(challengeId)) return;
      map.set(challengeId, duel._id);
    });
    return map;
  }, [duels]);

  const linkedDuelIdForNotification = useCallback((notification) => {
    const metadata = notification?.metadata || {};
    const directDuelId = String(metadata.duelId || metadata.duel || '').trim();
    if (directDuelId) return directDuelId;
    const challengeId = String(metadata.challengeId || metadata.challenge || '').trim();
    if (!challengeId) return '';
    return String(bestDuelByChallengeId.get(challengeId) || '');
  }, [bestDuelByChallengeId]);

  async function openLinkedFromNotification(item, linkedDuelId, event) {
    if (event) event.stopPropagation();
    const readOk = await openNotification(item);
    if (!readOk) {
      setError('Impossible d’ouvrir ce message pour le moment. Réessaie.');
      return;
    }
    if (!linkedDuelId) return;
    const focus = item?.type === 'duel:proof_received' ? 'proofs' : '';
    onOpenRoom(linkedDuelId, focus);
  }

  return (
    <section className="page-stack">
      <div className="metric-grid">
        <article className="metric-card">
          <span>Notifications</span>
          <strong>{notifications.length}</strong>
        </article>
        <article className="metric-card">
          <span>Défis reçus</span>
          <strong>{incomingChallenges.length}</strong>
        </article>
        <article className="metric-card metric-card--accent">
          <span>Duels actifs</span>
          <strong>{activeDuels.length}</strong>
        </article>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Défis reçus</p>
            <h2>Répondre vite</h2>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="list-stack">
          {incomingChallenges.map((challenge) => (
            <article key={challenge._id} className="challenge-card">
              <div>
                <strong>{toDisplayName(challenge.challenger)}</strong>
                <small>{moneyOrDash(challenge.counterAmount || challenge.amount)} · {challenge.matchType || 'eFootball 1v1'}</small>
                <small>{downloadableText(challenge.rules)}</small>
              </div>
              <div className="inline-actions">
                <button type="button" className="secondary-button" onClick={() => declineChallenge(challenge._id)}>
                  Refuser
                </button>
                <button type="button" className="ghost-button" onClick={() => counterChallenge(challenge._id)}>
                  Contre-proposer
                </button>
                <button type="button" className="primary-button" onClick={() => acceptChallenge(challenge._id)}>
                  Accepter
                </button>
              </div>
            </article>
          ))}
          {!incomingChallenges.length && <div className="empty-card">Aucun défi reçu.</div>}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Détails</p>
            <h2>Notification sélectionnée</h2>
          </div>
          {selectedNotification && (
            <button type="button" className="ghost-button" onClick={() => setSelectedNotificationId('')}>
              Fermer
            </button>
          )}
        </div>
        {!selectedNotification && <div className="empty-card">Clique sur une notification pour voir les détails, la capture ou l’action liée.</div>}
        {selectedNotification && (
          <div className="detail-layout">
            <div className="detail-card">
              <div className="detail-card__header">
                <div>
                  <strong>{selectedNotification.title}</strong>
                  <small>{selectedNotification.body}</small>
                </div>
                <span>{timeAgo(selectedNotification.createdAt)}</span>
              </div>

              {selectedDeposit && (
                <div className="detail-stack">
                  <div className="detail-kv">
                    <span>Montant</span>
                    <strong>{moneyOrDash(selectedDeposit.amount)}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Méthode</span>
                    <strong>{String(selectedDeposit.method || '').toUpperCase()}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Expéditeur</span>
                    <strong>{selectedDeposit.senderName || '—'}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Téléphone</span>
                    <strong>{selectedDeposit.senderPhone || '—'}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Référence</span>
                    <strong>{selectedDeposit.transactionReference || '—'}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Statut</span>
                    <strong>{labelForStatus(selectedDeposit.status)}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Vérification OCR</span>
                    <strong>{labelForOcrVerificationStatus(selectedDeposit.autoVerificationStatus)}</strong>
                  </div>
                  {selectedDepositScreenshot && (
                    <img className="proof-image" src={selectedDepositScreenshot} alt="Capture de dépôt" />
                  )}
                </div>
              )}

              {selectedWithdrawal && (
                <div className="detail-stack">
                  <div className="detail-kv">
                    <span>Montant</span>
                    <strong>{moneyOrDash(selectedWithdrawal.amount)}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Frais</span>
                    <strong>{moneyOrDash(selectedWithdrawal.feeAmount)}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Net</span>
                    <strong>{moneyOrDash(selectedWithdrawal.netAmount)}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Méthode</span>
                    <strong>{selectedWithdrawal.method || '—'}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Destinataire</span>
                    <strong>{selectedWithdrawal.phoneOrWallet || '—'}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Statut</span>
                    <strong>{labelForStatus(selectedWithdrawal.status)}</strong>
                  </div>
                </div>
              )}

              {selectedDuel && (
                <div className="detail-stack">
                  <div className="detail-kv">
                    <span>Joueur 1</span>
                    <strong>{toDisplayName(selectedDuel.player1)}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Joueur 2</span>
                    <strong>{toDisplayName(selectedDuel.player2)}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Montant</span>
                    <strong>{moneyOrDash(selectedDuel.amount)}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Pot total</span>
                    <strong>{moneyOrDash(selectedDuel.potTotal)}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Statut</span>
                    <strong>{labelForStatus(selectedDuel.status)}</strong>
                  </div>
                </div>
              )}

              {!selectedDeposit && !selectedWithdrawal && !selectedDuel && (
                <div className="detail-stack">
                  <div className="detail-kv">
                    <span>Type</span>
                    <strong>{selectedNotification.type}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Contenu</span>
                    <strong>{downloadableText(selectedNotification.body) || 'Aucun détail supplémentaire.'}</strong>
                  </div>
                  {Object.keys(selectedMetadata).length > 0 && (
                    <pre className="detail-json">{JSON.stringify(selectedMetadata, null, 2)}</pre>
                  )}
                </div>
              )}
            </div>

            <div className="detail-actions">
              {(selectedNotification.type === 'challenge_received' || selectedNotification.type === 'challenge:new') && selectedChallengeId && (
                <>
                  <button type="button" className="primary-button" onClick={() => acceptChallenge(selectedChallengeId)}>
                    Accepter
                  </button>
                  <button type="button" className="secondary-button" onClick={() => declineChallenge(selectedChallengeId)}>
                    Refuser
                  </button>
                  <button type="button" className="ghost-button" onClick={() => counterChallenge(selectedChallengeId)}>
                    Contre-proposer
                  </button>
                </>
              )}
              {(selectedDuelId || selectedChallengeId) && (
                <button type="button" className="secondary-button" onClick={openSelectedRoom}>
                  Ouvrir le détail lié
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Notifications</p>
            <h2>Système et argent</h2>
          </div>
          <div className="inline-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => api('/notifications/read-all', { method: 'PATCH' }).then(() => {
                setNotifications((current) => current.map((item) => ({ ...item, isRead: true })));
                onReadAllComplete?.();
              })}
            >
              Tout marquer comme lu
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => { void clearAllNotifications(); }}
            >
              Tout effacer
            </button>
          </div>
        </div>
        <div className="filter-row">
          {[
            ['all', 'Toutes'],
            ['unread', 'Non lues'],
            ['deposit', 'Dépôts'],
            ['withdrawal', 'Retraits'],
            ['duel', 'Duels'],
            ['challenge', 'Défis'],
            ['security', 'Sécurité']
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`filter-chip ${notificationFilter === value ? 'is-active' : ''}`}
              onClick={() => setNotificationFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          value={notificationQuery}
          onChange={(event) => setNotificationQuery(event.target.value)}
          placeholder="Rechercher par titre, joueur, montant ou statut"
        />
        <div className="list-stack">
          {filteredNotifications.map((item) => {
            const linkedDuelId = linkedDuelIdForNotification(item);
            return (
              <div key={item._id} className={`notification-item notification-item--row ${item.isRead ? '' : 'is-unread'}`}>
                <button type="button" className="notification-item__main" onClick={() => { void openNotification(item); }}>
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.body}</small>
                  </div>
                  <span>{timeAgo(item.createdAt)}</span>
                </button>
                {linkedDuelId && (
                  <button
                    type="button"
                    className="ghost-button notification-item__open"
                    onClick={(e) => { void openLinkedFromNotification(item, linkedDuelId, e); }}
                  >
                    Ouvrir
                  </button>
                )}
                <button
                  type="button"
                  className="ghost-button notification-item__trash"
                  aria-label="Supprimer la notification"
                  onClick={(e) => deleteNotification(item._id, e)}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            );
          })}
          {!filteredNotifications.length && <div className="empty-card">Aucune notification pour ce filtre.</div>}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Salles</p>
            <h2>Duels en cours</h2>
          </div>
        </div>
        <div className="list-stack">
          {activeDuels.map((duel) => (
            <article key={duel._id} className="list-row">
              <div>
                <strong>{toDisplayName(duel.player1)} vs {toDisplayName(duel.player2)}</strong>
                <small>{labelForStatus(duel.status)} · {moneyOrDash(duel.amount)} · pot {moneyOrDash(duel.potTotal)}</small>
              </div>
              <button type="button" className="primary-button" onClick={() => onOpenRoom(duel._id)}>
                Ouvrir
              </button>
            </article>
          ))}
          {!activeDuels.length && <div className="empty-card">Aucune salle active.</div>}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Joueurs</p>
            <h2>Accès profil</h2>
          </div>
        </div>
        <button type="button" className="secondary-button" onClick={() => onOpenProfile(user)}>
          Voir mon profil
        </button>
      </div>
    </section>
  );
}

function RoomView({ duelId, user, refreshTick, socket, focus, onRefresh, onBack }) {
  const [duel, setDuel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState('');
  const [myScore, setMyScore] = useState('');
  const [opponentScore, setOpponentScore] = useState('');
  const [winnerChoice, setWinnerChoice] = useState(''); // 'won' ou 'lost'
  const [submitting, setSubmitting] = useState(false);
  const [submissionInfo, setSubmissionInfo] = useState('');
  const [messages, setMessages] = useState([]);
  const [chatDraft, setChatDraft] = useState('');

  const me = duel && String(duel.player1?._id || duel.player1) === String(user._id)
    ? duel.player1
    : duel && String(duel.player2?._id || duel.player2) === String(user._id)
      ? duel.player2
      : user;
  const opponent = duel && String(duel.player1?._id || duel.player1) === String(user._id)
    ? duel.player2
    : duel?.player1;
  const isPlayer1 = duel && String(duel.player1?._id || duel.player1) === String(user._id);
  const isPlayer2 = duel && String(duel.player2?._id || duel.player2) === String(user._id);
  const isParticipant = Boolean(isPlayer1 || isPlayer2);
  const myResult = isPlayer1 ? duel?.resultPlayer1 : isPlayer2 ? duel?.resultPlayer2 : null;
  const opponentResult = isPlayer1 ? duel?.resultPlayer2 : isPlayer2 ? duel?.resultPlayer1 : null;
  const proofCards = duel
    ? [
      { key: 'player1', player: duel.player1, result: duel.resultPlayer1 },
      { key: 'player2', player: duel.player2, result: duel.resultPlayer2 }
    ].filter((item) => item.result?.submittedAt)
    : [];
  const roomStateText = duel?.status === 'finished'
    ? 'Statut : match terminé'
    : ['cancelled', 'dispute', 'under_review'].includes(duel?.status)
      ? `Statut : ${labelForStatus(duel.status)}`
      : 'Statut : salle en cours';
  const disputeReason = duel?.disputeReason || duel?.autoValidationReason || '';
  const disputeReasonText = friendlyDisputeReason(disputeReason);
  const validationLabel = duel?.autoValidationStatus === 'auto_approved'
    ? 'Validation automatique réussie'
    : duel?.autoValidationStatus === 'failed'
      ? 'Échec de validation automatique'
      : duel?.autoValidationStatus === 'manual_review'
        ? 'En attente de contrôle manuel'
        : '';
  const lastVerificationSummary = duel
    ? [
      duel.ocrScorePlayer1 ? `Capture 1: ${duel.ocrScorePlayer1} (${duel.ocrConfidencePlayer1 || 0}%)` : '',
      duel.ocrScorePlayer2 ? `Capture 2: ${duel.ocrScorePlayer2} (${duel.ocrConfidencePlayer2 || 0}%)` : '',
      duel.manualReviewDueAt ? `Contrôle admin attendu avant ${timeAgo(duel.manualReviewDueAt)}` : ''
    ].filter(Boolean).join(' ? ')
    : '';
  const realtimeProofHint = isParticipant && myResult && !opponentResult
    ? 'Ta preuve a ete envoyee. En attente de ton adversaire.'
    : isParticipant && !myResult && opponentResult
      ? 'Ton adversaire a envoye sa preuve. Envoie la tienne maintenant.'
      : duel?.status === 'analyzing'
        ? 'Verification automatique en cours...'
        : '';

  useEffect(() => {
    let active = true;
    setLoading(!loadedOnce);
    api(`/duels/${duelId}`)
      .then((data) => {
        if (!active) return;
        setDuel(data.duel);
        setLoadedOnce(true);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [duelId, refreshTick, loadedOnce]);

  useEffect(() => {
    if (!socket || !duel?.roomId) return undefined;
    socket.emit('duel:join', duel.roomId);

    const handleMessage = (payload) => {
      setMessages((current) => [...current, payload].slice(-30));
    };

    socket.on('duel:message', handleMessage);
    return () => {
      socket.off('duel:message', handleMessage);
    };
  }, [socket, duel?.roomId]);

  async function submitProof(event) {
    event.preventDefault();
    if (!duel) return;
    setSubmitting(true);
    setError('');
    setSubmissionInfo('');

    try {
      const response = await api(`/duels/${duel._id}/proof`, {
        method: 'POST',
        body: {
          myScore,
          opponentScore,
          winnerChoice
        }
      });
      setMyScore('');
      setOpponentScore('');
      setWinnerChoice('');
      setSubmissionInfo(response.message || 'Résultat enregistré');
      onRefresh();
    } catch (err) {
      const normalized = String(err?.message || '');
      if (/trop de temps|connexion|network/i.test(normalized)) {
        setSubmissionInfo('Analyse en cours. Si besoin, verification manuelle en cours.');
        onRefresh();
        return;
      }
      setError(normalized || 'Verification manuelle en cours.');
    } finally {
      setSubmitting(false);
    }
  }


  function sendChat(event) {
    event.preventDefault();
    if (!socket || !duel?.roomId || !downloadableText(chatDraft)) return;
    socket.emit('duel:message', { roomId: duel.roomId, message: chatDraft });
    setChatDraft('');
  }

  return (
    <section className="page-stack">
      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Salle de match</p>
            <h2>{toDisplayName(duel?.player1)} vs {toDisplayName(duel?.player2)}</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onBack}>
            Retour
          </button>
        </div>
        {loading && !loadedOnce && <div className="empty-card"><Loader2 size={16} className="spin" aria-hidden="true" /> Chargement en cours…</div>}
        {error && <p className="error">{error}</p>}
        {duel && (
          <div className="metric-grid">
            <article className="metric-card">
              <span>Mise</span>
              <strong>{moneyOrDash(duel.amount)}</strong>
            </article>
            <article className="metric-card">
              <span>Pot total</span>
              <strong>{moneyOrDash(duel.potTotal)}</strong>
            </article>
            <article className="metric-card metric-card--accent">
              <span>Gain net</span>
              <strong>{moneyOrDash(duel.winnerAmount)}</strong>
            </article>
          </div>
        )}
        {submissionInfo && <p className="muted">{submissionInfo}</p>}
      </div>

      {duel && (
        <>
          <div className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Statut</p>
                <h2>{roomStateText}</h2>
              </div>
              <span className={toneClass(duel.status)}>{labelForStatus(duel.status)}</span>
            </div>
            <p className="muted">{downloadableText(duel.rules) || 'Règles non précisées.'}</p>
            {realtimeProofHint && <p className="muted">{realtimeProofHint}</p>}
            {duel.status === 'dispute' && (
              <div className="warning-card">
                <strong>Pourquoi ce litige a été ouvert</strong>
                <p>{disputeReasonText}</p>
                {validationLabel && <small>{validationLabel}</small>}
              </div>
            )}
            {duel.status !== 'dispute' && disputeReason && (
              <div className="warning-card">
                <strong>Dernière vérification</strong>
                <p>{disputeReasonText}</p>
                {validationLabel && <small>{validationLabel}</small>}
              </div>
            )}
            {lastVerificationSummary && (
              <div className="warning-card">
                <strong>Résumé vérification</strong>
                <p>{lastVerificationSummary}</p>
              </div>
            )}
          </div>

          {proofCards.length > 0 && (
            <div className={`panel ${focus === 'proofs' ? 'is-focused' : ''}`}>
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Résultats</p>
                  <h2>Scores déclarés</h2>
                </div>
              </div>
              <div className="proof-grid">
                {proofCards.map((item) => (
                  <article key={item.key} className="proof-card">
                    <div>
                      <strong>{toDisplayName(item.player)}</strong>
                      <small>{item.result.score} · {timeAgo(item.result.submittedAt)}</small>
                    </div>
                    <div style={{ padding: '12px', background: 'var(--bg-1)', borderRadius: '8px', marginTop: 8 }}>
                      <small style={{ color: 'var(--muted)' }}>
                        Score: {item.result.myScore}-{item.result.opponentScore}
                      </small>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}

          {isParticipant && !myResult && !['finished', 'dispute', 'cancelled'].includes(duel.status) && (
            <form className="panel form-panel" onSubmit={submitProof}>
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Résultat</p>
                  <h2>Déclarer le score</h2>
                </div>
              </div>

              <label>
                Ton score
                <input type="number" value={myScore} onChange={(event) => setMyScore(event.target.value)} placeholder="Ex: 3" inputMode="numeric" min="0" step="1" required />
              </label>

              <label>
                Score de l'adversaire
                <input type="number" value={opponentScore} onChange={(event) => setOpponentScore(event.target.value)} placeholder="Ex: 1" inputMode="numeric" min="0" step="1" required />
              </label>

              <label>
                Résultat du match
                <select
                  value={winnerChoice}
                  onChange={(event) => setWinnerChoice(event.target.value)}
                  required
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--accent-2)', background: 'var(--bg-0)' }}
                >
                  <option value="">-- Choisir --</option>
                  <option value="won">✅ J'ai GAGNÉ</option>
                  <option value="lost">❌ J'ai PERDU</option>
                </select>
              </label>

              <p className="muted">
                Déclare ton score et celui de ton adversaire. Si les deux joueurs sont d'accord,
                le duel se termine automatiquement et le gagnant reçoit la mise.
              </p>

              {error && <p className="error">{error}</p>}
              <button type="submit" className="primary-button" disabled={submitting || !winnerChoice}>
                {submitting ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
                Valider le résultat
              </button>
            </form>
          )}

          {!isParticipant && (
            <div className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Accès lecture</p>
                  <h2>Tu consultes cette salle en mode spectateur</h2>
                </div>
              </div>
              <p className="muted">L’envoi de preuve est réservé aux deux joueurs du duel. Les spectateurs et l’équipe peuvent voir la salle, mais pas envoyer de capture.</p>
            </div>
          )}

          {isParticipant && myResult && !['finished', 'dispute', 'cancelled'].includes(duel.status) && (
            <div className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Preuve</p>
                  <h2>Capture déjà envoyée</h2>
                </div>
              </div>
              <p className="muted">La salle reste ouverte pendant que l’autre joueur envoie sa preuve ou que le verdict arrive.</p>
            </div>
          )}

          <div className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Chat optionnel</p>
                <h2>Coordination rapide</h2>
              </div>
            </div>
            <div className="chat-box">
              <div className="chat-log">
                {messages.length === 0 && <p className="muted">Aucun message de salle pour l'instant.</p>}
                {messages.map((item, index) => (
                  <p key={`${item.sentAt || index}-${index}`}>
                    <strong>{item.userId === user._id ? 'Moi' : 'Autre'}:</strong> {item.message}
                  </p>
                ))}
              </div>
              <form className="chat-form" onSubmit={sendChat}>
                <input value={chatDraft} onChange={(event) => setChatDraft(event.target.value)} placeholder="Message à l’adversaire…" />
                <button type="submit" className="primary-button">
                  <MessageSquare size={16} aria-hidden="true" />
                </button>
              </form>
            </div>
            <p className="muted">Quand les deux preuves sont envoyées, la plateforme compare les captures et rend le verdict automatiquement ou ouvre un litige.</p>
          </div>
        </>
      )}
    </section>
  );
}

function ProfileView({ user, target, refreshTick, onOpenChallenge, onGoAdmin, onUserUpdate }) {
  const [profile, setProfile] = useState(target || user);
  const [recentDuels, setRecentDuels] = useState([]);
  const [selfWalletLoading, setSelfWalletLoading] = useState(false);
  const [selfWalletLoadedOnce, setSelfWalletLoadedOnce] = useState(false);

  useEffect(() => {
    let active = true;
    const targetId = target?._id || user._id;
    if (String(targetId) === String(user._id)) {
      setProfile((current) => ({ ...current, ...user }));
      setRecentDuels([]);
      setSelfWalletLoading(true);
      Promise.all([
        api('/auth/me').catch(() => null),
        api('/wallet').catch(() => null)
      ])
        .then(([meData, walletData]) => {
          if (!active) return;
          const freshUser = meData?.user || null;
          const wallet = walletData?.wallet || walletData || null;
          if (freshUser && typeof onUserUpdate === 'function') {
            onUserUpdate(freshUser);
          }
          setProfile((current) => ({
            ...current,
            ...user,
            ...(freshUser || {}),
            ...(wallet
              ? {
                wallet,
                balanceAvailable: wallet.balanceAvailable,
                balanceLocked: wallet.balanceLocked,
                balanceTotal: wallet.balanceTotal
              }
              : {})
          }));
        })
        .finally(() => {
          if (active) {
            setSelfWalletLoading(false);
            setSelfWalletLoadedOnce(true);
          }
        });
      return () => {
        active = false;
      };
    }

    setSelfWalletLoading(false);
    api(`/users/${targetId}`)
      .then((data) => {
        if (!active) return;
        setProfile(data.user);
        setRecentDuels(data.recentDuels || []);
      })
      .catch(() => { });
    return () => {
      active = false;
    };
  }, [target?._id, user._id, refreshTick]);

  const isSelf = !target || String(target._id) === String(user._id);
  const displayedBalance = isSelf && selfWalletLoading && !selfWalletLoadedOnce ? '...' : moneyOrDash(walletBalance(profile));

  return (
    <section className="page-stack">
      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Profil</p>
            <h2>{toDisplayName(profile)}</h2>
          </div>
          {user.role === 'admin' && isSelf && (
            <button type="button" className="secondary-button" onClick={onGoAdmin}>
              Administration
            </button>
          )}
        </div>

        <div className="profile-card">
          <div className="profile-badge">
            <UserRound size={22} aria-hidden="true" />
          </div>
          <div className="profile-copy">
            <strong>{profile.efootballUsername || profile.username}</strong>
            <small>SK2C: {profile.username}</small>
          </div>
        </div>

        <div className="metric-grid">
          <article className="metric-card">
            <span>Victoires</span>
            <strong>{profile.wins || 0}</strong>
          </article>
          <article className="metric-card">
            <span>Défaites</span>
            <strong>{profile.losses || 0}</strong>
          </article>
          <article className="metric-card metric-card--accent">
            <span>Gains</span>
            <strong>{moneyOrDash(profile.totalEarnings)}</strong>
          </article>
          {isSelf && (
            <article className="metric-card">
              <span>Solde dispo</span>
              <strong>{displayedBalance}</strong>
            </article>
          )}
        </div>
      </div>

      {!isSelf && (
        <div className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Derniers duels</p>
              <h2>Résultats récents</h2>
            </div>
          </div>
          <div className="list-stack">
            {recentDuels.map((duel) => (
              <article key={duel._id} className="list-row">
                <div>
                  <strong>{toDisplayName(duel.player1)} vs {toDisplayName(duel.player2)}</strong>
                  <small>{labelForStatus(duel.status)} · {duel.winner ? `Gagnant : ${toDisplayName(duel.winner)}` : 'Résultat en attente'}</small>
                </div>
                <span className="pill pill--neutral">{duel.matchType || 'Duel'}</span>
              </article>
            ))}
            {!recentDuels.length && <div className="empty-card">Aucun duel récent.</div>}
          </div>
        </div>
      )}

      {isSelf && <TelegramSettings />}
    </section>
  );
}

// ============================================
// COMPOSANT: RÉINITIALISATION SÉCURISÉE DES COMPTES
// ============================================
function WalletResetPanel() {
  const [step, setStep] = useState(1); // 1: Request, 2: Confirm, 3: Success
  const [reason, setReason] = useState('');
  const [requestId, setRequestId] = useState('');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [doubleConfirm, setDoubleConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState(null);

  async function handleRequest() {
    if (!reason || reason.length < 10) {
      setError('Veuillez expliquer la raison (min 10 caractères)');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await api('/admin/wallets/request-reset', {
        method: 'POST',
        body: { reason }
      });

      setRequestId(response.requestId);
      setPreview(response.summary);
      setStep(2);
    } catch (err) {
      setError(err.message || 'Erreur lors de la demande');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!confirmationCode || confirmationCode.length !== 6) {
      setError('Veuillez entrer le code de confirmation à 6 chiffres');
      return;
    }

    if (!doubleConfirm) {
      setError('Vous devez cocher la confirmation finale');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await api('/admin/wallets/confirm-reset', {
        method: 'POST',
        body: {
          requestId,
          confirmationCode,
          doubleConfirm: 'RESET_ALL_WALLETS_CONFIRMED'
        }
      });

      setResult(response);
      setStep(3);
    } catch (err) {
      setError(err.message || 'Erreur lors de la confirmation');
    } finally {
      setLoading(false);
    }
  }

  function handleCancel() {
    if (requestId) {
      api('/admin/wallets/cancel-reset', {
        method: 'POST',
        body: { requestId }
      }).catch(() => { });
    }
    setStep(1);
    setReason('');
    setRequestId('');
    setConfirmationCode('');
    setDoubleConfirm(false);
    setError('');
    setResult(null);
    setPreview(null);
  }

  return (
    <div className="panel" style={{ border: '2px solid #dc2626', background: 'linear-gradient(135deg, #fef2f2, #fff5f5)' }}>
      <div className="panel-head">
        <div>
          <p className="eyebrow" style={{ color: '#dc2626' }}>⚠️ ACTION CRITIQUE</p>
          <h2 style={{ color: '#dc2626' }}>Réinitialisation des comptes</h2>
        </div>
        <span className="pill pill--danger">DANGER</span>
      </div>

      {step === 1 && (
        <div className="detail-stack">
          <div style={{
            padding: '16px',
            background: '#fee2e2',
            borderRadius: '8px',
            border: '1px solid #fecaca',
            marginBottom: '16px'
          }}>
            <p style={{ color: '#991b1b', fontWeight: 600, marginBottom: '8px' }}>
              🚨 ATTENTION: Action irréversible
            </p>
            <p style={{ color: '#7f1d1d', fontSize: '0.9rem' }}>
              Cette action va mettre à <strong>ZÉRO</strong> tous les soldes disponibles
              et bloqués de <strong>TOUS</strong> les utilisateurs. Cela inclut:
            </p>
            <ul style={{ color: '#7f1d1d', fontSize: '0.85rem', marginTop: '8px', marginLeft: '20px' }}>
              <li>Soldes disponibles (balanceAvailable)</li>
              <li>Soldes bloqués dans les duels (balanceLocked)</li>
              <li>Toutes les transactions seront loguées</li>
            </ul>
          </div>

          <label className="field-label">
            Raison de la réinitialisation (obligatoire)
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex: Réinitialisation complète pour test, migration de système, etc."
              rows={3}
              maxLength={500}
              required
            />
            <small style={{ color: '#666' }}>{reason.length}/500 caractères (min 10)</small>
          </label>

          {error && <p className="error">{error}</p>}

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              type="button"
              className="primary-button"
              onClick={handleRequest}
              disabled={loading || reason.length < 10}
              style={{ background: '#dc2626' }}
            >
              {loading ? 'Chargement...' : 'Étape 1: Créer la demande'}
            </button>
          </div>
        </div>
      )}

      {step === 2 && preview && (
        <div className="detail-stack">
          <div style={{
            padding: '16px',
            background: '#fef3c7',
            borderRadius: '8px',
            border: '1px solid #fcd34d',
            marginBottom: '16px'
          }}>
            <p style={{ color: '#92400e', fontWeight: 600, marginBottom: '12px' }}>
              📊 Résumé des comptes avant réinitialisation
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <span style={{ fontSize: '0.85rem', color: '#666' }}>Comptes affectés</span>
                <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1f2937' }}>
                  {preview.walletsCount}
                </p>
              </div>
              <div>
                <span style={{ fontSize: '0.85rem', color: '#666' }}>Total disponible</span>
                <p style={{ fontSize: '1.2rem', fontWeight: 600, color: '#059669' }}>
                  {moneyOrDash(preview.totalAvailable)}
                </p>
              </div>
              <div>
                <span style={{ fontSize: '0.85rem', color: '#666' }}>Total bloqué</span>
                <p style={{ fontSize: '1.2rem', fontWeight: 600, color: '#d97706' }}>
                  {moneyOrDash(preview.totalLocked)}
                </p>
              </div>
              <div>
                <span style={{ fontSize: '0.85rem', color: '#666' }}>TOTAL GÉNÉRAL</span>
                <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#dc2626' }}>
                  {moneyOrDash(preview.totalAll)}
                </p>
              </div>
            </div>
          </div>

          <div style={{
            padding: '16px',
            background: '#dbeafe',
            borderRadius: '8px',
            border: '1px solid #93c5fd',
            marginBottom: '16px'
          }}>
            <p style={{ color: '#1e40af', fontWeight: 600, marginBottom: '8px' }}>
              🔐 Confirmation requise
            </p>
            <p style={{ color: '#1e3a8a', fontSize: '0.9rem' }}>
              Un code de confirmation à 6 chiffres a été généré.
              Entrez-le ci-dessous pour continuer.
              <strong>(Expire dans 10 minutes)</strong>
            </p>
            <p style={{
              marginTop: '12px',
              padding: '12px',
              background: '#fff',
              borderRadius: '6px',
              fontFamily: 'monospace',
              fontSize: '1.2rem',
              textAlign: 'center',
              letterSpacing: '4px',
              color: '#dc2626'
            }}>
              CODE: <strong>{/* En prod: envoyé par email */} VÉRIFIEZ VOS EMAILS</strong>
            </p>
            <p style={{ fontSize: '0.75rem', color: '#6b7280', textAlign: 'center', marginTop: '4px' }}>
              Pour ce test, le code est affiché dans la console backend
            </p>
          </div>

          <label className="field-label">
            Code de confirmation (6 chiffres)
            <input
              type="text"
              value={confirmationCode}
              onChange={(e) => setConfirmationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              maxLength={6}
              style={{ fontSize: '1.5rem', letterSpacing: '8px', textAlign: 'center' }}
            />
          </label>

          <label style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            padding: '12px',
            background: '#fef2f2',
            borderRadius: '6px',
            cursor: 'pointer'
          }}>
            <input
              type="checkbox"
              checked={doubleConfirm}
              onChange={(e) => setDoubleConfirm(e.target.checked)}
              style={{ marginTop: '2px' }}
            />
            <span style={{ fontSize: '0.9rem', color: '#991b1b' }}>
              Je confirme comprendre que cette action va <strong>VIDER DÉFINITIVEMENT</strong>
              tous les comptes utilisateurs. Cette action est <strong>IRREVERSIBLE</strong>.
            </span>
          </label>

          {error && <p className="error" style={{ fontSize: '0.9rem' }}>{error}</p>}

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              type="button"
              className="secondary-button"
              onClick={handleCancel}
              disabled={loading}
            >
              Annuler
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={handleConfirm}
              disabled={loading || confirmationCode.length !== 6 || !doubleConfirm}
              style={{ background: '#dc2626', flex: 1 }}
            >
              {loading ? 'Exécution...' : 'Étape 2: CONFIRMER LA RÉINITIALISATION'}
            </button>
          </div>
        </div>
      )}

      {step === 3 && result && (
        <div className="detail-stack">
          <div style={{
            padding: '24px',
            background: '#d1fae5',
            borderRadius: '12px',
            border: '2px solid #10b981',
            textAlign: 'center'
          }}>
            <p style={{ fontSize: '3rem', marginBottom: '8px' }}>✅</p>
            <h3 style={{ color: '#065f46', marginBottom: '12px' }}>
              Réinitialisation exécutée avec succès
            </h3>
            <p style={{ color: '#047857' }}>
              {result.summary.walletsReset} comptes ont été réinitialisés
            </p>
            <p style={{ color: '#dc2626', fontWeight: 600, fontSize: '1.2rem', marginTop: '12px' }}>
              Total vidé: {moneyOrDash(result.summary.totalEmptied)}
            </p>
          </div>

          <div style={{ padding: '16px', background: '#f3f4f6', borderRadius: '8px' }}>
            <p style={{ fontWeight: 600, marginBottom: '8px' }}>Détails:</p>
            <ul style={{ fontSize: '0.9rem', color: '#4b5563', marginLeft: '20px' }}>
              <li>Comptes modifiés: {result.results.walletsModified}</li>
              <li>Transactions loguées: {result.results.transactionsCreated}</li>
              <li>Backup créé avant action</li>
              <li>Audit trail complet enregistré</li>
            </ul>
          </div>

          <button
            type="button"
            className="primary-button"
            onClick={handleCancel}
            style={{ background: '#059669' }}
          >
            Terminé - Revenir au début
          </button>
        </div>
      )}
    </div>
  );
}

function AdminView({ refreshTick, onRefresh, focusInboxItemId = '' }) {
  const [data, setData] = useState({
    inbox: { items: [], counts: { total: 0, deposits: 0, withdrawals: 0, disputes: 0 } },
    deposits: [],
    withdrawals: [],
    disputes: [],
    users: [],
    wallets: [],
    auditLogs: [],
    ocrSummary: null,
    overview: null
  });
  const [pushForm, setPushForm] = useState({
    userId: '',
    type: 'admin_alert',
    title: '',
    message: '',
    priority: 'high'
  });
  const [pushStatus, setPushStatus] = useState('');
  const [note, setNote] = useState('');
  const [selectedInboxItemId, setSelectedInboxItemId] = useState('');
  const [inboxFilter, setInboxFilter] = useState(() => window.localStorage.getItem('sk2c:adminInboxFilter') || 'all');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const [balanceForm, setBalanceForm] = useState({
    userId: '',
    operation: 'add',
    amount: '',
    description: ''
  });

  // Nouveaux états pour les fonctionnalités avancées
  const [activeTab, setActiveTab] = useState('dashboard');
  const [userSearchFilters, setUserSearchFilters] = useState({
    q: '',
    status: '',
    minEarnings: '',
    maxReports: '',
    sortBy: 'createdAt',
    order: 'desc'
  });
  const [disputeDetails, setDisputeDetails] = useState(null);
  const [loadingDisputeDetails, setLoadingDisputeDetails] = useState(false);
  const [exportPeriod, setExportPeriod] = useState({ from: '', to: '', status: '' });
  const [exportData, setExportData] = useState(null);
  const [timeRange, setTimeRange] = useState('today'); // today, week, month

  function load() {
    Promise.all([
      api('/admin/inbox'),
      api('/admin/deposits?status=pending'),
      api('/admin/withdrawals?status=pending'),
      api('/admin/disputes'),
      api('/admin/users'),
      api('/admin/audit-logs?limit=20'),
      api('/admin/ocr-summary'),
      api('/admin/overview')
    ])
      .then(([inbox, deposits, withdrawals, disputes, users, auditLogs, ocrSummary, overview]) => {
        setData({
          inbox,
          deposits: deposits.deposits || [],
          withdrawals: withdrawals.withdrawals || [],
          disputes: disputes.disputes || [],
          users: users.users || [],
          wallets: users.wallets || [],
          auditLogs: auditLogs.logs || [],
          ocrSummary: ocrSummary || null,
          overview: overview || null
        });
      })
      .catch(() => { });
  }

  // Charger les détails d'un litige
  async function loadDisputeDetails(duelId) {
    setLoadingDisputeDetails(true);
    try {
      const details = await api(`/admin/disputes/${duelId}/details`);
      setDisputeDetails(details);
    } catch (err) {
      console.error('Erreur chargement détails litige:', err);
    } finally {
      setLoadingDisputeDetails(false);
    }
  }

  // Recherche avancée utilisateurs
  async function searchUsers() {
    const params = new URLSearchParams();
    if (userSearchFilters.q) params.append('q', userSearchFilters.q);
    if (userSearchFilters.status) params.append('status', userSearchFilters.status);
    if (userSearchFilters.minEarnings) params.append('minEarnings', userSearchFilters.minEarnings);
    if (userSearchFilters.maxReports) params.append('maxReports', userSearchFilters.maxReports);
    params.append('sortBy', userSearchFilters.sortBy);
    params.append('order', userSearchFilters.order);

    try {
      const result = await api(`/admin/users/search?${params.toString()}`);
      setData(prev => ({ ...prev, users: result.users || [] }));
    } catch (err) {
      console.error('Erreur recherche utilisateurs:', err);
    }
  }

  // Export des données
  async function exportDuels() {
    const params = new URLSearchParams();
    if (exportPeriod.from) params.append('from', exportPeriod.from);
    if (exportPeriod.to) params.append('to', exportPeriod.to);
    if (exportPeriod.status) params.append('status', exportPeriod.status);

    try {
      const result = await api(`/admin/export/duels?${params.toString()}`);
      setExportData(result);
      // Créer fichier CSV
      const csv = convertToCSV(result.data);
      downloadCSV(csv, `duels_export_${new Date().toISOString().split('T')[0]}.csv`);
    } catch (err) {
      console.error('Erreur export:', err);
    }
  }

  function convertToCSV(data) {
    if (!data || !data.length) return '';
    const headers = Object.keys(data[0]);
    const rows = data.map(row => headers.map(h => JSON.stringify(row[h] || '')).join(' ? '));
    return [headers.join(' ? '), ...rows].join('\n');
  }

  function downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  }

  const walletsByUserId = new Map((data.wallets || []).map((wallet) => [String(wallet.user), wallet]));
  const selectedBalanceUser = data.users.find((user) => String(user._id) === String(balanceForm.userId));
  const filteredUsers = useMemo(() => {
    const normalized = userQuery.trim().toLowerCase();
    if (!normalized) return data.users;
    return data.users.filter((user) => {
      const haystack = [
        user.username,
        user.efootballUsername,
        user.email,
        user.country,
        user.status,
        user.role,
        toDisplayName(user)
      ]
        .filter(Boolean)
        .join(' ? ')
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [data.users, userQuery]);
  const inboxItems = data.inbox?.items || [];
  const filteredInboxItems = inboxItems.filter((item) => {
    if (inboxFilter !== 'ocr_timeout') return true;
    if (item?.type !== 'dispute') return false;
    const itemDisputeReason = String(item?.payload?.disputeReason || item?.payload?.autoValidationReason || '');
    return /timeout|6\s*minutes|dépassé/i.test(itemDisputeReason);
  });
  const selectedInboxItem = filteredInboxItems.find((item) => String(item.id) === String(selectedInboxItemId)) || filteredInboxItems[0] || null;
  const selectedDisputePayload = selectedInboxItem?.type === 'dispute' ? selectedInboxItem.payload || {} : null;
  const disputeProofPlayer1 = selectedDisputePayload?.proofImages?.player1 || selectedDisputePayload?.resultPlayer1?.screenshot || '';
  const disputeProofPlayer2 = selectedDisputePayload?.proofImages?.player2 || selectedDisputePayload?.resultPlayer2?.screenshot || '';
  const disputeReason = selectedDisputePayload?.disputeReason || selectedDisputePayload?.autoValidationReason || '';
  const selectedDisputeIsOcrTimeout = /timeout|6\s*minutes|dépassé/i.test(String(disputeReason || ''));

  useEffect(() => {
    load();
  }, [refreshTick]);

  useEffect(() => {
    if (!focusInboxItemId) return;
    setInboxFilter('all');
    setSelectedInboxItemId(String(focusInboxItemId));
  }, [focusInboxItemId]);

  useEffect(() => {
    if (!filteredInboxItems.length) {
      setSelectedInboxItemId('');
      return;
    }

    if (!selectedInboxItemId || !filteredInboxItems.some((item) => String(item.id) === String(selectedInboxItemId))) {
      setSelectedInboxItemId(String(filteredInboxItems[0].id));
    }
  }, [filteredInboxItems, selectedInboxItemId]);

  useEffect(() => {
    try {
      window.localStorage.setItem('sk2c:adminInboxFilter', inboxFilter);
    } catch { }
  }, [inboxFilter]);

  async function approveDeposit(id) {
    await api(`/admin/deposits/${id}/approve`, { method: 'POST', body: { adminNote: note } });
    setNote('');
    onRefresh();
    load();
  }

  async function rejectDeposit(id) {
    await api(`/admin/deposits/${id}/reject`, { method: 'POST', body: { adminNote: note } });
    setNote('');
    onRefresh();
    load();
  }

  async function approveWithdrawal(id) {
    await api(`/admin/withdrawals/${id}/approve`, { method: 'POST', body: { adminNote: note } });
    setNote('');
    onRefresh();
    load();
  }

  async function rejectWithdrawal(id) {
    await api(`/admin/withdrawals/${id}/reject`, { method: 'POST', body: { adminNote: note } });
    setNote('');
    onRefresh();
    load();
  }

  async function resolveDispute(id, winnerId) {
    setResolving(true);
    setResolveError('');
    try {
      await api(`/admin/disputes/${id}/resolve`, {
        method: 'POST',
        body: { action: 'winner', winnerId, reason: note }
      });
      setNote('');
      setSelectedInboxItemId(''); // Clear selection so dispute disappears from detail view
      onRefresh();
      load();
    } catch (err) {
      setResolveError(err.message || 'Erreur lors de la résolution du litige');
    } finally {
      setResolving(false);
    }
  }

  async function cancelDispute(id) {
    setResolving(true);
    setResolveError('');
    try {
      await api(`/admin/disputes/${id}/resolve`, {
        method: 'POST',
        body: { action: 'cancel', reason: note || 'Litige résolu par remboursement' }
      });
      setNote('');
      setSelectedInboxItemId(''); // Clear selection so dispute disappears from detail view
      onRefresh();
      load();
    } catch (err) {
      setResolveError(err.message || 'Erreur lors de l\'annulation du litige');
    } finally {
      setResolving(false);
    }
  }

  async function cancelDisputeNoRefund(id) {
    setResolving(true);
    setResolveError('');
    try {
      await api(`/admin/disputes/${id}/resolve`, {
        method: 'POST',
        body: { action: 'cancel_no_refund', reason: note || 'Litige résolu - mises retenues par la plateforme' }
      });
      setNote('');
      setSelectedInboxItemId('');
      onRefresh();
      load();
    } catch (err) {
      setResolveError(err.message || 'Erreur lors de l\'annulation sans remboursement');
    } finally {
      setResolving(false);
    }
  }

  async function toggleBan(user, isBanned) {
    await api(`/admin/users/${user._id}/ban`, {
      method: 'POST',
      body: { isBanned }
    });
    onRefresh();
    load();
  }

  async function submitPushNotification(event) {
    event.preventDefault();
    setPushStatus('');
    if (!pushForm.userId || !pushForm.title || !pushForm.message) {
      setPushStatus('err: Champs obligatoires manquants');
      return;
    }
    try {
      await api('/notifications/admin', {
        method: 'POST',
        body: {
          userId: pushForm.userId,
          type: pushForm.type,
          title: pushForm.title,
          message: pushForm.message,
          priority: pushForm.priority,
          data: { source: 'admin_panel' }
        }
      });
      setPushStatus('ok: Notification envoyée');
      setPushForm((f) => ({ ...f, title: '', message: '' }));
      onRefresh();
    } catch (err) {
      setPushStatus(`err: ${err.message || 'Échec envoi'}`);
    }
  }

  async function submitBalanceAdjustment(event) {
    event.preventDefault();
    if (!balanceForm.userId) return;

    await api(`/admin/users/${balanceForm.userId}/adjust-balance`, {
      method: 'POST',
      body: {
        amount: Number(balanceForm.amount),
        operation: balanceForm.operation,
        description: balanceForm.description || 'Ajustement manuel administrateur'
      }
    });
    setBalanceForm({ userId: '', operation: 'add', amount: '', description: '' });
    onRefresh();
    load();
  }

  // Données pour le dashboard
  const overview = data.overview || {};
  const timeStats = overview.timeStats || {};

  return (
    <section className="page-stack">
      {/* Navigation par onglets Admin */}
      <div className="panel" style={{ padding: '8px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {[
            { id: 'dashboard', label: '📊 Dashboard', color: '#2457ff' },
            { id: 'inbox', label: `📥 Boîte (${data.inbox?.counts?.total || 0})`, color: '#10b981' },
            { id: 'users', label: '👥 Utilisateurs', color: '#f59e0b' },
            { id: 'disputes', label: `⚔️ Litiges (${data.inbox?.counts?.disputes || 0})`, color: '#ef4444' },
            { id: 'export', label: '📤 Export', color: '#8b5cf6' }
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '10px 16px',
                borderRadius: '10px',
                border: 'none',
                background: activeTab === tab.id ? tab.color : 'var(--bg-1)',
                color: activeTab === tab.id ? '#fff' : 'var(--text)',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ===== DASHBOARD TAB ===== */}
      {activeTab === 'dashboard' && (
        <>
          {/* Métriques principales */}
          <div className="metric-grid">
            <article className="metric-card metric-card--accent">
              <span>Utilisateurs</span>
              <strong>{overview.users || 0}</strong>
            </article>
            <article className="metric-card">
              <span>Duels actifs</span>
              <strong>{overview.activeDuels || 0}</strong>
            </article>
            <article className="metric-card" style={{ borderColor: '#f59e0b' }}>
              <span>Litiges</span>
              <strong>{overview.disputes || 0}</strong>
            </article>
            <article className="metric-card" style={{ borderColor: '#8b5cf6' }}>
              <span>Commissions</span>
              <strong>{moneyOrDash(overview.commissionsEarned)}</strong>
            </article>
          </div>

          {/* Stats temps réel */}
          <div className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Statistiques temps réel</p>
                <h2>Performance de la plateforme</h2>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {['today', 'week', 'month'].map(range => (
                  <button
                    key={range}
                    type="button"
                    onClick={() => setTimeRange(range)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '8px',
                      border: 'none',
                      background: timeRange === range ? '#2457ff' : 'var(--bg-1)',
                      color: timeRange === range ? '#fff' : 'var(--text)',
                      fontSize: '0.85rem',
                      cursor: 'pointer'
                    }}
                  >
                    {range === 'today' ? 'Aujourd\'hui' : range === 'week' ? '7 jours' : '30 jours'}
                  </button>
                ))}
              </div>
            </div>

            <div className="metric-grid" style={{ marginTop: '16px' }}>
              <article className="metric-card">
                <span>Duels {timeRange === 'today' ? "aujourd'hui" : timeRange === 'week' ? 'cette semaine' : 'ce mois'}</span>
                <strong>{timeStats[timeRange]?.count || timeStats.today?.count || 0}</strong>
              </article>
              <article className="metric-card">
                <span>Montant total</span>
                <strong>{moneyOrDash(timeStats[timeRange]?.totalAmount || timeStats.today?.totalAmount || 0)}</strong>
              </article>
              <article className="metric-card" style={{ borderColor: '#10b981' }}>
                <span>Terminés</span>
                <strong>{timeStats[timeRange]?.finished || timeStats.today?.finished || 0}</strong>
              </article>
            </div>

            {/* Top joueurs */}
            <div style={{ marginTop: '24px' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '12px' }}>🏆 Top joueurs (par gains)</h3>
              <div className="list-stack">
                {(overview.topUsers || []).slice(0, 5).map((user, index) => (
                  <article key={user._id} className="list-row" style={{
                    background: index === 0 ? 'linear-gradient(135deg, #ffd70020, #ffed4a20)' :
                      index === 1 ? 'linear-gradient(135deg, #c0c0c020, #e8e8e820)' :
                        index === 2 ? 'linear-gradient(135deg, #cd7f3220, #daa52020)' : 'var(--bg-0)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '1.5rem' }}>
                        {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`}
                      </span>
                      <div>
                        <strong>{toDisplayName(user)}</strong>
                        <small>{user.wins || 0} victoires</small>
                      </div>
                    </div>
                    <strong style={{ color: '#10b981' }}>{moneyOrDash(user.totalEarnings)}</strong>
                  </article>
                ))}
              </div>
            </div>
          </div>

          {/* Portefeuille global */}
          <div className="metric-grid">
            <article className="metric-card" style={{ borderColor: '#10b981' }}>
              <span>Solde disponible (tous users)</span>
              <strong>{moneyOrDash(overview.wallets?.available)}</strong>
            </article>
            <article className="metric-card" style={{ borderColor: '#f59e0b' }}>
              <span>Solde bloqué (mises)</span>
              <strong>{moneyOrDash(overview.wallets?.locked)}</strong>
            </article>
            <article className="metric-card" style={{ borderColor: '#2457ff' }}>
              <span>Total en circulation</span>
              <strong>{moneyOrDash(overview.wallets?.total)}</strong>
            </article>
          </div>
        </>
      )}

      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Push joueur</p>
            <h2>Notification temps réel</h2>
          </div>
        </div>
        <form className="detail-stack" onSubmit={submitPushNotification}>
          <label className="field-label">
            Utilisateur
            <select
              value={pushForm.userId}
              onChange={(e) => setPushForm((f) => ({ ...f, userId: e.target.value }))}
              required
            >
              <option value="">— Choisir —</option>
              {data.users.map((u) => (
                <option key={u._id} value={u._id}>{u.username} · {u.email}</option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Type
            <select
              value={pushForm.type}
              onChange={(e) => setPushForm((f) => ({ ...f, type: e.target.value }))}
            >
              <option value="admin_alert">Alerte administrative</option>
              <option value="system_alert">Alerte système</option>
              <option value="challenge_received">Défi reçu</option>
              <option value="deposit_pending">Dépôt en attente</option>
              <option value="deposit_validated">Dépôt validé</option>
              <option value="payment_sent">Paiement envoyé</option>
            </select>
          </label>
          <label className="field-label">
            Titre
            <input value={pushForm.title} onChange={(e) => setPushForm((f) => ({ ...f, title: e.target.value }))} maxLength={200} required />
          </label>
          <label className="field-label">
            Message
            <textarea value={pushForm.message} onChange={(e) => setPushForm((f) => ({ ...f, message: e.target.value }))} maxLength={2000} required rows={3} />
          </label>
          <label className="field-label">
            Priorité
            <select value={pushForm.priority} onChange={(e) => setPushForm((f) => ({ ...f, priority: e.target.value }))}>
              <option value="low">Basse</option>
              <option value="normal">Normale</option>
              <option value="medium">Moyenne</option>
              <option value="high">Haute</option>
              <option value="urgent">Urgente</option>
            </select>
          </label>
          {pushStatus && (
            <p className={pushStatus.startsWith('ok:') ? 'muted-line' : 'error'}>{pushStatus.replace(/^(ok:|err:)\s*/, '')}</p>
          )}
          <button type="submit" className="primary-button">Envoyer au joueur</button>
        </form>
      </div>

      {/* ============================================
          SYSTÈME DE RÉINITIALISATION DES COMPTES
          ============================================ */}
      <WalletResetPanel />

      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Boîte</p>
            <h2>Détails instantanés</h2>
          </div>
          <span className="pill pill--neutral">{selectedInboxItem ? selectedInboxItem.type : 'Aucun élément'}</span>
        </div>
        <div className="filter-row">
          <button
            type="button"
            className={`filter-chip ${inboxFilter === 'all' ? 'is-active' : ''}`}
            onClick={() => setInboxFilter('all')}
          >
            Tous
          </button>
          <button
            type="button"
            className={`filter-chip ${inboxFilter === 'ocr_timeout' ? 'is-active' : ''}`}
            onClick={() => setInboxFilter('ocr_timeout')}
          >
            Timeout OCR
          </button>
        </div>
        {!selectedInboxItem && <div className="empty-card">Aucune notification disponible.</div>}
        {selectedInboxItem && (
          <div className="detail-layout detail-layout--admin">
            <div className="list-stack admin-inbox-list">
              {filteredInboxItems.map((item) => (
                (() => {
                  const itemDisputeReason = item?.type === 'dispute'
                    ? String(item?.payload?.disputeReason || item?.payload?.autoValidationReason || '')
                    : '';
                  const itemIsOcrTimeout = /timeout|6\s*minutes|dépassé/i.test(itemDisputeReason);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`notification-item ${String(item.id) === String(selectedInboxItemId) ? 'is-selected' : ''}`}
                      onClick={() => setSelectedInboxItemId(String(item.id))}
                    >
                      <div>
                        <strong>{item.title}</strong>
                        <small>
                          {toDisplayName(item.actor)} {item.amount ? `· ${moneyOrDash(item.amount)}` : ''}
                          {itemIsOcrTimeout ? ' · Timeout OCR' : ''}
                        </small>
                      </div>
                      <span>{timeAgo(item.createdAt)}</span>
                    </button>
                  );
                })()
              ))}
            </div>

            <div className="detail-card">
              <div className="detail-card__header">
                <div>
                  <strong>{selectedInboxItem.title}</strong>
                  <small>{labelForNotificationType(selectedInboxItem.type)} · {selectedInboxItem.status ? labelForStatus(selectedInboxItem.status) : 'En attente'}</small>
                </div>
                <div className="detail-actions">
                  {selectedDisputeIsOcrTimeout && <span className="pill pill--warning">Timeout OCR</span>}
                  <span>{timeAgo(selectedInboxItem.createdAt)}</span>
                </div>
              </div>

              <div className="detail-stack">
                <div className="detail-kv">
                  <span>Acteur</span>
                  <strong>{toDisplayName(selectedInboxItem.actor)}</strong>
                </div>
                {selectedInboxItem.amount != null && (
                  <div className="detail-kv">
                    <span>Montant</span>
                    <strong>{moneyOrDash(selectedInboxItem.amount)}</strong>
                  </div>
                )}
                {selectedInboxItem.opponent && (
                  <div className="detail-kv">
                    <span>Adversaire</span>
                    <strong>{toDisplayName(selectedInboxItem.opponent)}</strong>
                  </div>
                )}
              </div>

              {selectedInboxItem.type === 'deposit' && selectedInboxItem.payload && (
                <div className="detail-stack">
                  <div className="detail-kv">
                    <span>Méthode</span>
                    <strong>{String(selectedInboxItem.payload.method || '').toUpperCase()}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Expéditeur</span>
                    <strong>{selectedInboxItem.payload.senderName || '—'}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Téléphone</span>
                    <strong>{selectedInboxItem.payload.senderPhone || '—'}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Référence</span>
                    <strong>{selectedInboxItem.payload.transactionReference || '—'}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>OCR</span>
                    <strong>{labelForOcrVerificationStatus(selectedInboxItem.payload.autoVerificationStatus)}</strong>
                  </div>
                  {selectedInboxItem.payload.fraudScore != null && (
                    <div className="detail-kv">
                      <span>Risque fraude</span>
                      <strong><span className={fraudPillClass(selectedInboxItem.payload.fraudScore)}>{Math.round(Number(selectedInboxItem.payload.fraudScore || 0))}/100</span></strong>
                    </div>
                  )}
                  {formatFraudFlags(selectedInboxItem.payload.fraudFlags).length > 0 && (
                    <div className="detail-kv detail-kv--reason">
                      <span>Signaux</span>
                      <strong>{formatFraudFlags(selectedInboxItem.payload.fraudFlags).join(' ? ')}</strong>
                    </div>
                  )}
                  {selectedInboxItem.payload.screenshotUrl && (
                    <img className="proof-image" src={selectedInboxItem.payload.screenshotUrl} alt="Capture de dépôt" />
                  )}
                </div>
              )}

              {selectedInboxItem.type === 'withdrawal' && selectedInboxItem.payload && (
                <div className="detail-stack">
                  <div className="detail-kv">
                    <span>Méthode</span>
                    <strong>{selectedInboxItem.payload.method || '—'}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Destinataire</span>
                    <strong>{selectedInboxItem.payload.phoneOrWallet || '—'}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Frais</span>
                    <strong>{moneyOrDash(selectedInboxItem.payload.feeAmount)}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Net</span>
                    <strong>{moneyOrDash(selectedInboxItem.payload.netAmount)}</strong>
                  </div>
                  {selectedInboxItem.payload.fraudScore != null && (
                    <div className="detail-kv">
                      <span>Risque fraude</span>
                      <strong><span className={fraudPillClass(selectedInboxItem.payload.fraudScore)}>{Math.round(Number(selectedInboxItem.payload.fraudScore || 0))}/100</span></strong>
                    </div>
                  )}
                  {formatFraudFlags(selectedInboxItem.payload.fraudFlags).length > 0 && (
                    <div className="detail-kv detail-kv--reason">
                      <span>Signaux</span>
                      <strong>{formatFraudFlags(selectedInboxItem.payload.fraudFlags).join(' ? ')}</strong>
                    </div>
                  )}
                </div>
              )}

              {selectedInboxItem.type === 'dispute' && selectedInboxItem.payload && (
                <div className="detail-stack detail-stack--dispute">
                  <div className="detail-kv">
                    <span>Joueur 1</span>
                    <strong>{toDisplayName(selectedInboxItem.payload.player1)}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Joueur 2</span>
                    <strong>{toDisplayName(selectedInboxItem.payload.player2)}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Statut</span>
                    <strong>{labelForStatus(selectedInboxItem.payload.status)}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Pot</span>
                    <strong>{moneyOrDash(selectedInboxItem.payload.potTotal)}</strong>
                  </div>
                  {disputeReason && (
                    <div className="detail-kv detail-kv--reason">
                      <span>Motif</span>
                      <strong>{disputeReason}</strong>
                    </div>
                  )}
                  {disputeSignalSummary(selectedInboxItem.payload).length > 0 && (
                    <div className="detail-kv detail-kv--reason">
                      <span>Indicateurs</span>
                      <strong>{disputeSignalSummary(selectedInboxItem.payload).join(' ? ')}</strong>
                    </div>
                  )}
                  {(disputeProofPlayer1 || disputeProofPlayer2) && (
                    <div className="proof-grid">
                      {disputeProofPlayer1 && (
                        <div className="proof-card">
                          <strong>Capture joueur 1</strong>
                          <img className="proof-image" src={disputeProofPlayer1} alt="Capture duel joueur 1" />
                        </div>
                      )}
                      {disputeProofPlayer2 && (
                        <div className="proof-card">
                          <strong>Capture joueur 2</strong>
                          <img className="proof-image" src={disputeProofPlayer2} alt="Capture duel joueur 2" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {selectedInboxItem.type === 'username' && selectedInboxItem.payload && (
                <div className="detail-stack">
                  <div className="detail-kv">
                    <span>Utilisateur</span>
                    <strong>{toDisplayName(selectedInboxItem.payload.user)}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Demandé</span>
                    <strong>{selectedInboxItem.payload.requestedUsername || '—'}</strong>
                  </div>
                  <div className="detail-kv">
                    <span>Statut</span>
                    <strong>{labelForStatus(selectedInboxItem.payload.status)}</strong>
                  </div>
                </div>
              )}

              {selectedInboxItem.payload?.adminNote && (
                <div className="detail-kv">
                  <span>Note</span>
                  <strong>{selectedInboxItem.payload.adminNote}</strong>
                </div>
              )}
            </div>

            <div className="detail-actions">
              {selectedInboxItem.type === 'deposit' && (
                <>
                  <button type="button" className="primary-button" onClick={() => approveDeposit(selectedInboxItem.id)}>
                    Valider
                  </button>
                  <button type="button" className="secondary-button" onClick={() => rejectDeposit(selectedInboxItem.id)}>
                    Rejeter
                  </button>
                </>
              )}
              {selectedInboxItem.type === 'withdrawal' && (
                <>
                  <button type="button" className="primary-button" onClick={() => approveWithdrawal(selectedInboxItem.id)}>
                    Valider
                  </button>
                  <button type="button" className="secondary-button" onClick={() => rejectWithdrawal(selectedInboxItem.id)}>
                    Rejeter
                  </button>
                </>
              )}
              {selectedInboxItem.type === 'dispute' && (
                <>
                  {resolveError && (
                    <div className="error-card" style={{ marginBottom: 12, padding: 12, background: 'rgba(190, 18, 60, 0.1)', borderRadius: 8, color: '#be123c' }}>
                      <strong>Erreur:</strong> {resolveError}
                    </div>
                  )}
                  <button
                    type="button"
                    className="primary-button"
                    disabled={resolving}
                    onClick={() => resolveDispute(selectedInboxItem.id, selectedInboxItem.payload.player1?._id || selectedInboxItem.payload.player1)}
                  >
                    {resolving ? 'Traitement...' : 'Valider joueur 1'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={resolving}
                    onClick={() => resolveDispute(selectedInboxItem.id, selectedInboxItem.payload.player2?._id || selectedInboxItem.payload.player2)}
                  >
                    {resolving ? 'Traitement...' : 'Valider joueur 2'}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={resolving}
                    onClick={() => cancelDispute(selectedInboxItem.id)}
                  >
                    {resolving ? 'Traitement...' : 'Annuler et rembourser'}
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    disabled={resolving}
                    onClick={() => cancelDisputeNoRefund(selectedInboxItem.id)}
                    title="Annule le duel sans rembourser - les mises restent sur le compte plateforme"
                  >
                    {resolving ? 'Traitement...' : 'Annuler (sans remboursement)'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Commissions</p>
            <h2>Gestion automatique</h2>
          </div>
        </div>
        <div className="empty-card">
          Les commissions sont calculées automatiquement par la plateforme selon la mise du duel.
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">OCR</p>
            <h2>Résumé de validation</h2>
          </div>
        </div>
        <div className="proof-grid">
          <article className="proof-card">
            <strong>Duels OCR</strong>
            <small>Validations automatiques : {data.ocrSummary?.duelOcr?.autoApproved || 0}</small>
            <small>Contrôles manuels : {data.ocrSummary?.duelOcr?.manualReview || 0}</small>
            <small>Échecs : {data.ocrSummary?.duelOcr?.failed || 0}</small>
          </article>
          <article className="proof-card">
            <strong>Dépôts OCR</strong>
            <small>Validés : {data.ocrSummary?.depositOcr?.matched || 0}</small>
            <small>À examiner : {data.ocrSummary?.depositOcr?.needsReview || 0}</small>
            <small>Échecs : {data.ocrSummary?.depositOcr?.failed || 0}</small>
            <small>En attente : {data.ocrSummary?.depositOcr?.pending || 0}</small>
          </article>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Activité</p>
            <h2>Actions récentes</h2>
          </div>
        </div>
        <div className="list-stack">
          {data.auditLogs.map((entry) => (
            <article key={entry._id} className="list-row">
              <div>
                <strong>{entry.action}</strong>
                <small>{toDisplayName(entry.admin)} · {entry.targetType} · {String(entry.note || entry.errorMessage || '').trim() || '—'}</small>
              </div>
              <span>{timeAgo(entry.createdAt)}</span>
            </article>
          ))}
          {!data.auditLogs.length && <div className="empty-card">Aucune action récente.</div>}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Note admin</p>
            <h2>Actions rapides</h2>
          </div>
        </div>
        <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Note admin optionnelle" />
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Utilisateurs</p>
            <h2>Ban / solde</h2>
          </div>
        </div>
        <div className="filter-row">
          <label className="search-field" style={{ maxWidth: 520 }}>
            <Search size={16} aria-hidden="true" />
            <input
              value={userQuery}
              onChange={(event) => setUserQuery(event.target.value)}
              placeholder="Rechercher un utilisateur"
            />
          </label>
        </div>
        <div className="list-stack">
          {filteredUsers.map((user) => {
            const wallet = walletsByUserId.get(String(user._id));
            return (
              <article key={user._id} className="list-row">
                <div>
                  <strong>{toDisplayName(user)}</strong>
                  <small>{user.email} · {user.country || 'Global'} · {user.isBanned ? 'Banni' : 'Actif'}</small>
                  <small>Solde : {moneyOrDash(wallet?.balanceAvailable ? 0)} · Bloqué : {moneyOrDash(wallet?.balanceLocked ? 0)}</small>
                </div>
                <div className="inline-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setBalanceForm({
                      userId: user._id,
                      operation: 'add',
                      amount: '',
                      description: `Ajustement manuel pour ${toDisplayName(user)}`
                    })}
                  >
                    Ajuster solde
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => toggleBan(user, !user.isBanned)}
                  >
                    {user.isBanned ? 'Débannir' : 'Bannir'}
                  </button>
                </div>
              </article>
            );
          })}
          {!filteredUsers.length && <div className="empty-card">Aucun utilisateur à afficher pour ce filtre.</div>}
        </div>
      </div>

      {balanceForm.userId && selectedBalanceUser && (
        <form className="panel form-panel" onSubmit={submitBalanceAdjustment}>
          <div className="panel-head">
            <div>
              <p className="eyebrow">Ajustement</p>
              <h2>{toDisplayName(selectedBalanceUser)}</h2>
            </div>
            <button type="button" className="ghost-button" onClick={() => setBalanceForm({ userId: '', operation: 'add', amount: '', description: '' })}>
              Fermer
            </button>
          </div>

          <label>
            Type d'ajustement
            <select
              value={balanceForm.operation}
              onChange={(event) => setBalanceForm((current) => ({ ...current, operation: event.target.value }))}
            >
              <option value="add">Ajouter des fonds</option>
              <option value="subtract">Réduire des fonds</option>
            </select>
          </label>
          <label>
            Montant
            <input
              type="number"
              min="1"
              value={balanceForm.amount}
              onChange={(event) => setBalanceForm((current) => ({ ...current, amount: event.target.value }))}
              placeholder="Ex: 1500"
            />
          </label>
          <label>
            Description
            <textarea
              rows={3}
              value={balanceForm.description}
              onChange={(event) => setBalanceForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Motif de l'ajustement"
            />
          </label>
          <button type="submit" className="primary-button">
            {balanceForm.operation === 'subtract' ? 'Réduire le solde' : 'Ajouter au solde'}
          </button>
        </form>
      )}

      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Dépôts</p>
            <h2>À valider</h2>
          </div>
        </div>
        <div className="list-stack">
          {data.deposits.map((deposit) => (
            <article key={deposit._id} className="list-row">
              <div>
                <strong>{toDisplayName(deposit.user)}</strong>
                <small>{moneyOrDash(deposit.amount)} · {deposit.method}</small>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  {deposit.fraudScore != null && (
                    <span className={fraudPillClass(deposit.fraudScore)}>Risque {Math.round(Number(deposit.fraudScore || 0))}/100</span>
                  )}
                  {formatFraudFlags(deposit.fraudFlags).slice(0, 2).map((flag) => (
                    <span key={flag} className="pill pill--neutral">{flag}</span>
                  ))}
                </div>
              </div>
              <div className="inline-actions">
                <button type="button" className="secondary-button" onClick={() => rejectDeposit(deposit._id)}>Rejeter</button>
                <button type="button" className="primary-button" onClick={() => approveDeposit(deposit._id)}>Valider</button>
              </div>
            </article>
          ))}
          {!data.deposits.length && <div className="empty-card">Aucun dépôt en attente.</div>}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Retraits</p>
            <h2>À traiter</h2>
          </div>
        </div>
        <div className="list-stack">
          {data.withdrawals.map((withdrawal) => (
            <article key={withdrawal._id} className="list-row">
              <div>
                <strong>{toDisplayName(withdrawal.user)}</strong>
                <small>{moneyOrDash(withdrawal.amount)} · {withdrawal.method}</small>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  {withdrawal.fraudScore != null && (
                    <span className={fraudPillClass(withdrawal.fraudScore)}>Risque {Math.round(Number(withdrawal.fraudScore || 0))}/100</span>
                  )}
                  {formatFraudFlags(withdrawal.fraudFlags).slice(0, 2).map((flag) => (
                    <span key={flag} className="pill pill--neutral">{flag}</span>
                  ))}
                </div>
              </div>
              <div className="inline-actions">
                <button type="button" className="secondary-button" onClick={() => rejectWithdrawal(withdrawal._id)}>Rejeter</button>
                <button type="button" className="primary-button" onClick={() => approveWithdrawal(withdrawal._id)}>Valider</button>
              </div>
            </article>
          ))}
          {!data.withdrawals.length && <div className="empty-card">Aucun retrait en attente.</div>}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Litiges</p>
            <h2>Résolution</h2>
          </div>
        </div>
        <div className="list-stack">
          {data.disputes.map((duel) => (
            <article key={duel._id} className="list-row">
              <div>
                <strong>{toDisplayName(duel.player1)} vs {toDisplayName(duel.player2)}</strong>
                <small>{labelForStatus(duel.status)} · {moneyOrDash(duel.potTotal)}</small>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  {duel.autoValidationStatus && (
                    <span className={toneClass(duel.status === 'dispute' ? 'dispute' : duel.autoValidationStatus)}>{labelForOcrVerificationStatus(duel.autoValidationStatus)}</span>
                  )}
                  {disputeSignalSummary(duel).slice(0, 2).map((signal) => (
                    <span key={signal} className="pill pill--neutral">{signal}</span>
                  ))}
                </div>
              </div>
              <div className="inline-actions">
                <button type="button" className="secondary-button" disabled={resolving} onClick={() => resolveDispute(duel._id, duel.player1?._id || duel.player1)}>{resolving ? '...' : 'J1 gagne'}</button>
                <button type="button" className="secondary-button" disabled={resolving} onClick={() => resolveDispute(duel._id, duel.player2?._id || duel.player2)}>{resolving ? '...' : 'J2 gagne'}</button>
                <button type="button" className="ghost-button" disabled={resolving} onClick={() => cancelDispute(duel._id)}>{resolving ? '...' : 'Rembourser'}</button>
                <button type="button" className="danger-button" disabled={resolving} onClick={() => cancelDisputeNoRefund(duel._id)} title="Annuler sans remboursement - mises retenues">{resolving ? '...' : 'Annuler'}</button>
              </div>
            </article>
          ))}
          {!data.disputes.length && <div className="empty-card">Aucun litige.</div>}
        </div>
      </div>
    </section>
  );
}

export default App;
