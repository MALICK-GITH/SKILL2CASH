/* @refresh reset */
import React, { useEffect, useMemo, useState } from 'react';
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
  Swords,
  Trophy,
  Upload,
  UserRound,
  Wallet,
  XCircle
} from 'lucide-react';
import { api, clearSession, getSocketUrl, getStoredUser, getToken, setSession } from './api.js';
import './styles.css';

const DEFAULT_METHOD = 'wave';
const WHATSAPP_GROUP_URL = 'https://chat.whatsapp.com/EL4j85SBKiIL7UI9NfeSAB';

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
    approved: 'Validé',
    rejected: 'Rejeté',
    paid: 'Payé',
    success: 'Succès',
    failed: 'Échec'
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
    admin_adjustment: 'Ajustement admin'
  };
  return labels[type] || type.replaceAll('_', ' ');
}

function toneForStatus(status = '') {
  if (['success', 'available', 'online', 'approved', 'finished', 'paid'].includes(status)) return 'success';
  if (['pending', 'analyzing', 'waiting_player1_proof', 'waiting_player2_proof', 'busy'].includes(status)) return 'warning';
  if (['rejected', 'declined', 'expired', 'dispute', 'failed', 'offline'].includes(status)) return 'danger';
  return 'neutral';
}

function toneClass(status) {
  return `pill pill--${toneForStatus(status)}`;
}

function downloadableText(value) {
  return String(value || '').trim();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Impossible de lire le fichier'));
    reader.readAsDataURL(file);
  });
}

function moneyOrDash(value) {
  return Number.isFinite(Number(value)) ? money(value) : '0 CFA';
}

function toDisplayName(user) {
  if (!user) return 'Joueur';
  return user.efootballUsername || user.username || 'Joueur';
}

function pageTitle(view) {
  const titles = {
    home: 'Accueil',
    play: 'Jouer',
    wallet: 'Wallet',
    deposit: 'Dépôt',
    withdraw: 'Retrait',
    leaderboard: 'Classement',
    history: 'Historique',
    inbox: 'Boîte de réception',
    profile: 'Profil',
    room: 'Salle de match',
    admin: 'Admin'
  };
  return titles[view] || 'SKILL2CASH';
}

function App() {
  const [user, setUser] = useState(getStoredUser());
  const [view, setView] = useState(user ? 'home' : 'landing');
  const [authMode, setAuthMode] = useState('login');
  const [toast, setToast] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [socket, setSocket] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [selectedDuelId, setSelectedDuelId] = useState(null);
  const [roomFocus, setRoomFocus] = useState('');
  const [profileTarget, setProfileTarget] = useState(null);
  const [challengeTarget, setChallengeTarget] = useState(null);

  const refresh = () => setRefreshTick((current) => current + 1);

  function navigate(nextView) {
    setView(nextView);
    if (nextView !== 'room') {
      setSelectedDuelId(null);
      setRoomFocus('');
    }
    if (nextView !== 'profile') setProfileTarget(null);
  }

  function openRoom(duelId, focus = '') {
    setSelectedDuelId(duelId);
    setRoomFocus(focus);
    setView('room');
  }

  function openProfile(target) {
    setProfileTarget(target || null);
    setView('profile');
  }

  function openChallengeTarget(target) {
    setChallengeTarget(target || null);
    setView('play');
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
    setView('landing');
  }

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

    api('/notifications?limit=1')
      .then((data) => setUnreadCount(Number(data.unreadCount || 0)))
      .catch(() => {});
  }, [user, refreshTick]);

  useEffect(() => {
    if (!user) return undefined;

    const nextSocket = io(getSocketUrl(), { auth: { token: getToken() } });
    setSocket(nextSocket);

    const handleEvent = (message) => {
      setToast(message);
      refresh();
    };

    nextSocket.on('challenge:new', (payload) => handleEvent(`Nouveau défi: ${money(payload.amount)}`));
    nextSocket.on('challenge:accepted', () => handleEvent('Défi accepté.'));
    nextSocket.on('challenge:declined', () => handleEvent('Défi refusé.'));
    nextSocket.on('deposit:submitted', () => handleEvent('Dépôt soumis.'));
    nextSocket.on('deposit:approved', (payload) => handleEvent(`Dépôt validé: ${money(payload.amount)}`));
    nextSocket.on('deposit:rejected', () => handleEvent('Dépôt rejeté.'));
    nextSocket.on('withdrawal:submitted', () => handleEvent('Retrait soumis.'));
    nextSocket.on('withdrawal:approved', () => handleEvent('Retrait validé.'));
    nextSocket.on('withdrawal:rejected', () => handleEvent('Retrait rejeté.'));
    nextSocket.on('duel:room_created', () => handleEvent('Salle de match créée.'));
    nextSocket.on('duel:proof_received', () => handleEvent('Capture reçue.'));
    nextSocket.on('duel:analysis_started', () => handleEvent('Analyse OCR en cours.'));
    nextSocket.on('duel:finished', () => handleEvent('Verdict final publié.'));
    nextSocket.on('duel:dispute_opened', () => handleEvent('Litige ouvert.'));
    nextSocket.on('wallet:updated', refresh);
    nextSocket.on('connect_error', (error) => {
      if (/auth|session|token/i.test(error.message || '')) {
        handleSessionExpired();
      }
    });

    return () => {
      nextSocket.disconnect();
      setSocket(null);
    };
  }, [user?._id]);

  useEffect(() => {
    if (!user || view !== 'inbox') return;
    api('/notifications/read-all', { method: 'PATCH' })
      .then(() => setUnreadCount(0))
      .catch(() => {});
  }, [user, view]);

  function logout() {
    clearSession();
    setUser(null);
    setSocket(null);
    setUnreadCount(0);
    setSelectedDuelId(null);
    setRoomFocus('');
    setProfileTarget(null);
    setChallengeTarget(null);
    setView('landing');
  }

  const navItems = useMemo(() => [
    { id: 'home', label: 'Accueil', icon: LayoutDashboard },
    { id: 'play', label: 'Jouer', icon: Gamepad2 },
    { id: 'wallet', label: 'Wallet', icon: Wallet },
    { id: 'inbox', label: 'Boîte', icon: Bell, badge: unreadCount },
    { id: 'profile', label: 'Profil', icon: UserRound }
  ], [unreadCount]);

  const content = (() => {
    if (!user && view === 'landing') {
      return <Landing onEnter={() => { setAuthMode('login'); setView('auth'); }} onRegister={() => { setAuthMode('register'); setView('auth'); }} />;
    }

    if (!user && view === 'auth') {
      return (
        <AuthView
          mode={authMode}
          onModeChange={setAuthMode}
          onSuccess={(payload) => {
            setSession(payload);
            setUser(payload.user);
            setView('home');
            refresh();
          }}
          onBack={() => setView('landing')}
        />
      );
    }

    if (!user) {
      return <Landing onEnter={() => { setAuthMode('login'); setView('auth'); }} onRegister={() => { setAuthMode('register'); setView('auth'); }} />;
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
                <span>Admin</span>
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
              <button type="button" className="ghost-button" onClick={() => refresh()}>
                <RefreshCw size={16} aria-hidden="true" />
                Rafraîchir
              </button>
              <button type="button" className="ghost-button" onClick={() => navigate('inbox')}>
                <Bell size={16} aria-hidden="true" />
                Boîte {unreadCount > 0 ? `(${unreadCount})` : ''}
              </button>
              <button type="button" className="ghost-button" onClick={logout}>
                <LogOut size={16} aria-hidden="true" />
                Déconnexion
              </button>
            </div>
          </header>

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
                refreshTick={refreshTick}
                onSuccess={() => {
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
              <AdminView refreshTick={refreshTick} onRefresh={refresh} />
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
    <main className="app-root">
      {toast && (
        <button type="button" className="toast" onClick={() => setToast('')}>
          <Bell size={16} aria-hidden="true" />
          <span>{toast}</span>
        </button>
      )}
      {content}
    </main>
  );
}

function Landing({ onEnter, onRegister }) {
  return (
    <section className="landing">
      <div className="landing-copy">
        <p className="eyebrow">Plateforme mobile-first</p>
        <h1>SKILL2CASH</h1>
        <p className="landing-text">
          Une interface claire pour gérer le wallet, lancer des duels et suivre chaque validation sans bruit inutile.
        </p>
        <div className="landing-community">
          <p className="landing-community-label">Communauté WhatsApp</p>
          <p className="landing-community-text">
            Rejoins le groupe pour parler avec les joueurs, signaler un souci et organiser les défis.
          </p>
          <a
            className="primary-button landing-community-button"
            href={WHATSAPP_GROUP_URL}
            target="_blank"
            rel="noreferrer"
          >
            Rejoindre
            <ChevronRight size={16} aria-hidden="true" />
          </a>
        </div>
        <div className="landing-actions">
          <button type="button" className="primary-button" onClick={onEnter}>
            Se connecter
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          <button type="button" className="secondary-button" onClick={onRegister}>
            Créer un compte
          </button>
        </div>
        <a
          className="cta-link cta-link--soft"
          href={WHATSAPP_GROUP_URL}
          target="_blank"
          rel="noreferrer"
        >
          Déjà prêt ? Rejoins le WhatsApp et entre dans la communauté avant de t’inscrire.
        </a>
      </div>

      <div className="landing-grid">
        <article className="feature-card">
          <strong>1. Déposer</strong>
          <p>Paiement Wave ou MTN, preuve obligatoire, validation backend.</p>
        </article>
        <article className="feature-card">
          <strong>2. Défier</strong>
          <p>Recherche joueur, mise, règles, invitation instantanée.</p>
        </article>
        <article className="feature-card">
          <strong>3. Verdict</strong>
          <p>Capture, OCR, litige si doute, paiement du gagnant.</p>
        </article>
      </div>
    </section>
  );
}

function AuthView({ mode, onModeChange, onSuccess, onBack }) {
  const [form, setForm] = useState({
    username: '',
    efootballUsername: '',
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    password: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      const payload = mode === 'login'
        ? { email: form.email, password: form.password }
        : {
            username: form.username,
            efootballUsername: form.efootballUsername,
            firstName: form.firstName,
            lastName: form.lastName,
            phone: form.phone,
            email: form.email,
            password: form.password
          };

      const data = await api(endpoint, { method: 'POST', body: payload });
      onSuccess(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="auth-shell">
      <div className="auth-card">
        <div className="auth-header">
          <button type="button" className="ghost-button" onClick={onBack}>
            <ChevronRight size={16} className="rotate-180" aria-hidden="true" />
            Retour
          </button>
          <div className="auth-tabs">
            <button type="button" className={mode === 'login' ? 'tab is-active' : 'tab'} onClick={() => onModeChange('login')}>
              Connexion
            </button>
            <button type="button" className={mode === 'register' ? 'tab is-active' : 'tab'} onClick={() => onModeChange('register')}>
              Inscription
            </button>
          </div>
        </div>

        <h2>{mode === 'login' ? 'Accès rapide' : 'Créer ton compte'}</h2>
        <p className="muted">
          Le pseudo SKILL2CASH et le pseudo eFootball sont séparés. C'est ce second pseudo qui servira à la vérification OCR.
        </p>

        <form className="auth-form" onSubmit={submit}>
          {mode === 'register' && (
            <>
              <label>
                Pseudo SKILL2CASH
                <input
                  value={form.username}
                  onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
                  placeholder="Ton pseudo SKILL2CASH"
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                Pseudo eFootball exact
                <input
                  value={form.efootballUsername}
                  onChange={(event) => setForm((current) => ({ ...current, efootballUsername: event.target.value }))}
                  placeholder="Pseudo exact eFootball"
                  required
                />
              </label>
              <label>
                Prénom
                <input
                  value={form.firstName}
                  onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))}
                  placeholder="Ton prénom"
                  autoComplete="given-name"
                  required
                />
              </label>
              <label>
                Nom
                <input
                  value={form.lastName}
                  onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))}
                  placeholder="Ton nom"
                  autoComplete="family-name"
                  required
                />
              </label>
              <label>
                Téléphone
                <input
                  value={form.phone}
                  onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                  placeholder="+225..."
                  autoComplete="tel"
                  required
                />
              </label>
            </>
          )}

          <label>
            Email
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              placeholder="nom@exemple.com"
              autoComplete="email"
              required
            />
          </label>

          <label>
            Mot de passe
            <div className="password-field">
            <input
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              placeholder="Au moins 8 caractères"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
            />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              >
                {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
              </button>
            </div>
          </label>

          {error && <p className="error">{error}</p>}
          <button type="submit" className="primary-button" disabled={loading}>
            {loading ? <Loader2 size={16} className="spin" aria-hidden="true" /> : null}
            {mode === 'login' ? 'Se connecter' : 'Créer le compte'}
          </button>
        </form>
      </div>
    </section>
  );
}

function DashboardView({ user, refreshTick, onGoPlay, onGoDeposit, onGoLeaderboard, onGoHistory }) {
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    api('/wallet')
      .then((data) => {
        if (!active) return;
        setWallet(data.wallet);
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
  }, [refreshTick]);

  return (
    <section className="page-stack">
      <div className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">Dashboard mobile</p>
          <h2>Solde, action, raccourcis.</h2>
          <p className="muted">Tout ce qui compte tient dans un seul écran, sans surcharge visuelle.</p>
        </div>
        <button type="button" className="primary-button hero-button" onClick={onGoPlay}>
          <Gamepad2 size={18} aria-hidden="true" />
          Jouer maintenant
        </button>
      </div>

      <div className="metric-grid">
        <article className="metric-card">
          <span>Solde disponible</span>
          <strong>{loading ? '...' : moneyOrDash(wallet?.balanceAvailable)}</strong>
        </article>
        <article className="metric-card">
          <span>Solde bloqué</span>
          <strong>{loading ? '...' : moneyOrDash(wallet?.balanceLocked)}</strong>
        </article>
        <article className="metric-card metric-card--accent">
          <span>Utilisateur</span>
          <strong>{toDisplayName(user)}</strong>
        </article>
      </div>

      {error && <div className="panel"><p className="error">{error}</p></div>}

      <div className="shortcut-grid">
        <button type="button" className="shortcut-card" onClick={onGoDeposit}>
          <Banknote size={18} aria-hidden="true" />
          <span>Déposer</span>
          <small>Dépôt rapide</small>
        </button>
        <button type="button" className="shortcut-card" onClick={onGoLeaderboard}>
          <Trophy size={18} aria-hidden="true" />
          <span>Classement</span>
          <small>Top joueurs</small>
        </button>
        <button type="button" className="shortcut-card" onClick={onGoHistory}>
          <History size={18} aria-hidden="true" />
          <span>Historique</span>
          <small>Matchs et cash</small>
        </button>
      </div>
    </section>
  );
}

function PlayView({ user, refreshTick, initialTarget, onOpenProfile, onChallengeCreated }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('available');
  const [loading, setLoading] = useState(false);
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(initialTarget || null);
  const [stake, setStake] = useState('');
  const [rules, setRules] = useState('Standard 10 min, capture required.');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (initialTarget) {
      setSelected(initialTarget);
    }
  }, [initialTarget?._id]);

  useEffect(() => {
    let active = true;
    const handle = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (status && status !== 'all') params.set('status', status);
      params.set('excludeId', user._id);
      params.set('limit', '12');

      api(`/users/search?${params.toString()}`)
        .then((data) => {
          if (!active) return;
          setPlayers(data.users || []);
        })
        .catch((err) => {
          if (!active) return;
          setError(err.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);

    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [query, status, refreshTick, user._id]);

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
      setRules('Standard 10 min, capture required.');
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
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="available">Disponible</option>
            <option value="online">En ligne</option>
            <option value="all">Tous</option>
          </select>
        </div>
      </div>

      <div className="player-grid">
        {loading && (
          <div className="empty-card">
            <Loader2 className="spin" size={18} aria-hidden="true" />
            Chargement des joueurs...
          </div>
        )}
        {!loading && players.map((player) => (
            <article key={player._id} className={`player-card ${selected?._id === player._id ? 'is-selected' : ''}`}>
            <div>
              <strong>{toDisplayName(player)}</strong>
              <small>SK2C: {player.username}</small>
            </div>
            <div className="player-meta">
              <span className={toneClass(player.status)}>{labelForStatus(player.status)}</span>
              <small>{player.winRate || 0}% win rate</small>
              <small>{moneyOrDash(player.totalEarnings)}</small>
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
        {!loading && players.length === 0 && (
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

  useEffect(() => {
    let active = true;
    setLoading(true);

    Promise.all([
      api('/wallet'),
      api('/wallet/transactions?limit=10')
    ])
      .then(([walletData, txData]) => {
        if (!active) return;
        setWallet(walletData.wallet);
        setTransactions(txData.transactions || []);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [refreshTick]);

  return (
    <section className="page-stack">
      <div className="metric-grid">
        <article className="metric-card">
          <span>Disponible</span>
          <strong>{loading ? '...' : moneyOrDash(wallet?.balanceAvailable)}</strong>
        </article>
        <article className="metric-card">
          <span>Bloqué</span>
          <strong>{loading ? '...' : moneyOrDash(wallet?.balanceLocked)}</strong>
        </article>
        <article className="metric-card metric-card--accent">
          <span>Total</span>
          <strong>{loading ? '...' : moneyOrDash(wallet?.balanceTotal)}</strong>
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
          <small>Validation admin</small>
        </button>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Transactions</p>
            <h2>Récent</h2>
          </div>
        </div>
        <div className="list-stack">
          {transactions.map((transaction) => (
            <article key={transaction._id} className="list-row">
              <div>
                <strong>{labelForTransaction(transaction.type)}</strong>
                <small>{transaction.description || 'Transaction'}</small>
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

function DepositView({ refreshTick, onSuccess, onBack }) {
  const [wallet, setWallet] = useState(null);
  const [method, setMethod] = useState(DEFAULT_METHOD);
  const [form, setForm] = useState({
    amount: '',
    senderName: '',
    senderPhone: '',
    transactionReference: '',
    screenshotUrl: ''
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    api('/wallet')
      .then((data) => {
        if (!active) return;
        setWallet(data);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [refreshTick]);

  const account = wallet?.paymentAccounts?.[method];

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    setForm((current) => ({ ...current, screenshotUrl: dataUrl }));
  }

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      await api('/wallet/deposit', {
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

        {loading && <div className="empty-card"><Loader2 size={16} className="spin" aria-hidden="true" /> Chargement...</div>}
        {!loading && account && (
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
          Référence transaction
          <input value={form.transactionReference} onChange={(event) => setForm((current) => ({ ...current, transactionReference: event.target.value }))} />
        </label>
        <label>
          Capture du paiement
          <input type="file" accept="image/*" onChange={handleFile} required />
        </label>

        {form.screenshotUrl && (
          <img className="proof-preview" src={form.screenshotUrl} alt="Prévisualisation de la capture de paiement" />
        )}
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary-button" disabled={submitting}>
          {submitting ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
          Soumettre le dépôt
        </button>
        <p className="muted">Le wallet n'est crédité qu'après validation backend. Les preuves douteuses restent en attente admin.</p>
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    api('/wallet')
      .then((data) => {
        if (!active) return;
        setWallet(data.wallet);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [refreshTick]);

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
            <strong>{loading ? '...' : moneyOrDash(wallet?.balanceAvailable)}</strong>
          </article>
          <article className="metric-card">
            <span>Bloqué</span>
            <strong>{loading ? '...' : moneyOrDash(wallet?.balanceLocked)}</strong>
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
            <option value="Mobile Money">Mobile Money</option>
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
        <p className="muted">Le retrait passe en attente. L'admin valide ou rejette, et aucune double validation n'est possible.</p>
      </form>
    </section>
  );
}

function LeaderboardView({ user, refreshTick }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('earnings');

  useEffect(() => {
    api('/leaderboard')
      .then(setData)
      .catch(() => {});
  }, [refreshTick]);

  const rows = tab === 'earnings'
    ? data?.topEarnings || []
    : tab === 'wins'
      ? data?.topWins || []
      : data?.topTrust || [];

  const podium = rows.slice(0, 3);
  const userRank = rows.findIndex((player) => String(player._id) === String(user._id));

  return (
    <section className="page-stack">
      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Classement</p>
            <h2>Top joueurs</h2>
          </div>
        </div>
        <div className="tab-row">
          <button type="button" className={tab === 'earnings' ? 'tab is-active' : 'tab'} onClick={() => setTab('earnings')}>Gains</button>
          <button type="button" className={tab === 'wins' ? 'tab is-active' : 'tab'} onClick={() => setTab('wins')}>Victoires</button>
          <button type="button" className={tab === 'trust' ? 'tab is-active' : 'tab'} onClick={() => setTab('trust')}>Trust</button>
        </div>
        <p className="muted">
          Ton rang actuel: {userRank >= 0 ? `#${userRank + 1}` : 'hors top 20'}
        </p>
      </div>

      <div className="podium-grid">
        {podium.map((player, index) => (
          <article key={player._id} className={`podium-card podium-card--${index + 1}`}>
            <span className="podium-rank">
              {index === 0 ? <Crown size={16} aria-hidden="true" /> : <Medal size={16} aria-hidden="true" />}
              Top {index + 1}
            </span>
            <strong>{toDisplayName(player)}</strong>
            <small>{player.efootballUsername || player.username}</small>
            <b>{moneyOrDash(player.totalEarnings)}</b>
          </article>
        ))}
      </div>

      <div className="panel">
        <h2>Liste</h2>
        <div className="list-stack">
          {rows.map((player, index) => (
            <article key={player._id} className={`list-row ${player._id === user._id ? 'is-self' : ''}`}>
              <div>
                <strong>#{index + 1} {toDisplayName(player)}</strong>
                <small>{player.efootballUsername || player.username} · {player.winRate || 0}% win rate</small>
              </div>
              <div className="row-meta">
                <strong>{moneyOrDash(player.totalEarnings)}</strong>
                <span className="pill pill--neutral">{player.rank || 'Bronze'}</span>
              </div>
            </article>
          ))}
          {!rows.length && <div className="empty-card">Aucune donnée de classement.</div>}
        </div>
      </div>
    </section>
  );
}

function HistoryView({ user, refreshTick }) {
  const [tab, setTab] = useState('matches');
  const [duels, setDuels] = useState([]);
  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    Promise.all([
      api('/duels'),
      api('/wallet/transactions?limit=20')
    ])
      .then(([duelsData, txData]) => {
        setDuels(duelsData.duels || []);
        setTransactions(txData.transactions || []);
      })
      .catch(() => {});
  }, [refreshTick]);

  function duelScore(duel) {
    if (duel.resultPlayer1?.score) return duel.resultPlayer1.score;
    if (duel.resultPlayer2?.score) return duel.resultPlayer2.score;
    return duel.status;
  }

  return (
    <section className="page-stack">
      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Historique</p>
            <h2>Matchs et cash</h2>
          </div>
        </div>
        <div className="tab-row">
          <button type="button" className={tab === 'matches' ? 'tab is-active' : 'tab'} onClick={() => setTab('matches')}>Matchs</button>
          <button type="button" className={tab === 'finance' ? 'tab is-active' : 'tab'} onClick={() => setTab('finance')}>Finances</button>
        </div>
      </div>

      {tab === 'matches' && (
        <div className="panel">
          <div className="list-stack">
            {duels.map((duel) => (
              <article key={duel._id} className="list-row">
                <div>
                  <strong>{toDisplayName(duel.player1)} vs {toDisplayName(duel.player2)}</strong>
                  <small>{labelForStatus(duel.status)} · score {duelScore(duel)} · {duel.matchType || 'Duel'}</small>
                </div>
                <div className="row-meta">
                  <strong>{moneyOrDash(duel.amount)}</strong>
                  <span className={toneClass(duel.status)}>{duel.winner ? 'Gagné' : labelForStatus(duel.status)}</span>
                </div>
              </article>
            ))}
            {!duels.length && <div className="empty-card">Aucun duel à afficher.</div>}
          </div>
        </div>
      )}

      {tab === 'finance' && (
        <div className="panel">
          <div className="list-stack">
            {transactions.map((transaction) => (
              <article key={transaction._id} className="list-row">
                <div>
                  <strong>{labelForTransaction(transaction.type)}</strong>
                  <small>{transaction.description || 'Transaction'}</small>
                </div>
                <div className="row-meta">
                  <strong>{moneyOrDash(transaction.amount)}</strong>
                  <span className={toneClass(transaction.status)}>{labelForStatus(transaction.status)}</span>
                </div>
              </article>
            ))}
            {!transactions.length && <div className="empty-card">Aucune transaction.</div>}
          </div>
        </div>
      )}
    </section>
  );
}

function InboxView({ user, refreshTick, onOpenRoom, onOpenProfile }) {
  const [notifications, setNotifications] = useState([]);
  const [incomingChallenges, setIncomingChallenges] = useState([]);
  const [duels, setDuels] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api('/notifications?limit=40'),
      api('/challenges/incoming'),
      api('/duels')
    ])
      .then(([notificationData, challengeData, duelData]) => {
        setNotifications(notificationData.notifications || []);
        setIncomingChallenges(challengeData.challenges || []);
        setDuels(duelData.duels || []);
      })
      .catch(() => {});
  }, [refreshTick]);

  function markNotificationRead(id) {
    setNotifications((current) => current.map((item) => (item._id === id ? { ...item, isRead: true } : item)));
  }

  async function openNotification(item) {
    setError('');
    try {
      await api(`/notifications/${item._id}/read`, { method: 'PATCH' });
      markNotificationRead(item._id);

      const metadata = item.metadata || {};
      const duelId = metadata.duelId || metadata.duel;
      const challengeId = metadata.challengeId || metadata.challenge;

      if (duelId) {
        onOpenRoom(duelId, item.type === 'duel:proof_received' ? 'proofs' : '');
        return;
      }

      if (item.type === 'challenge:new' && challengeId) {
        const data = await api(`/challenges/${challengeId}/accept`, { method: 'POST' });
        setIncomingChallenges((current) => current.filter((challenge) => challenge._id !== challengeId));
        if (data.duel?._id) onOpenRoom(data.duel._id);
        return;
      }

      const linkedDuel = duels.find((duel) => String(duel.challenge?._id || duel.challenge) === String(challengeId));
      if (linkedDuel?._id) {
        onOpenRoom(linkedDuel._id);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function acceptChallenge(id) {
    const data = await api(`/challenges/${id}/accept`, { method: 'POST' });
    if (data.duel?._id) onOpenRoom(data.duel._id);
  }

  async function declineChallenge(id) {
    await api(`/challenges/${id}/decline`, { method: 'POST' });
    setIncomingChallenges((current) => current.filter((item) => item._id !== id));
  }

  async function counterChallenge(id) {
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
  }

  const activeDuels = duels.filter((duel) => ['active', 'waiting_player1_proof', 'waiting_player2_proof', 'analyzing', 'dispute'].includes(duel.status));

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
            <p className="eyebrow">Notifications</p>
            <h2>Système et argent</h2>
          </div>
        </div>
        <div className="list-stack">
          {notifications.map((item) => (
            <button key={item._id} type="button" className={`notification-item ${item.isRead ? '' : 'is-unread'}`} onClick={() => openNotification(item)}>
              <div>
                <strong>{item.title}</strong>
                <small>{item.body}</small>
              </div>
              <span>{timeAgo(item.createdAt)}</span>
            </button>
          ))}
          {!notifications.length && <div className="empty-card">Aucune notification.</div>}
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
  const [error, setError] = useState('');
  const [score, setScore] = useState('');
  const [resultChoice, setResultChoice] = useState('win');
  const [screenshot, setScreenshot] = useState('');
  const [submitting, setSubmitting] = useState(false);
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
  const myResult = isPlayer1 ? duel?.resultPlayer1 : isPlayer2 ? duel?.resultPlayer2 : null;
  const proofCards = duel
    ? [
        { key: 'player1', player: duel.player1, result: duel.resultPlayer1 },
        { key: 'player2', player: duel.player2, result: duel.resultPlayer2 }
      ].filter((item) => item.result?.screenshot)
    : [];
  const roomStateText = duel?.status === 'finished'
    ? 'Statut: match termine'
    : ['cancelled', 'dispute'].includes(duel?.status)
      ? `Statut: ${labelForStatus(duel.status)}`
      : 'Statut: salle en cours';

  useEffect(() => {
    let active = true;
    setLoading(true);
    api(`/duels/${duelId}`)
      .then((data) => {
        if (!active) return;
        setDuel(data.duel);
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
  }, [duelId, refreshTick]);

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

    try {
      await api(`/duels/${duel._id}/result`, {
        method: 'POST',
        body: {
          score,
          declaredWinner: resultChoice === 'win' ? user._id : (String(duel.player1?._id || duel.player1) === String(user._id) ? duel.player2?._id || duel.player2 : duel.player1?._id || duel.player1),
          screenshot
        }
      });
      setScore('');
      setResultChoice('win');
      setScreenshot('');
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    setScreenshot(dataUrl);
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
        {loading && <div className="empty-card"><Loader2 size={16} className="spin" aria-hidden="true" /> Chargement...</div>}
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
      </div>

      {duel && (
        <>
          <div className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Statut</p>
                <h2>{roomStateText}</h2>
              </div>
              <span className={toneClass(duel.status)}>{duel.status}</span>
            </div>
            <p className="muted">{downloadableText(duel.rules) || 'Règles non précisées.'}</p>
          </div>

          {proofCards.length > 0 && (
            <div className={`panel ${focus === 'proofs' ? 'is-focused' : ''}`}>
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Captures</p>
                  <h2>Preuves envoyees</h2>
                </div>
              </div>
              <div className="proof-grid">
                {proofCards.map((item) => (
                  <article key={item.key} className="proof-card">
                    <div>
                      <strong>{toDisplayName(item.player)}</strong>
                      <small>{item.result.score} · {timeAgo(item.result.submittedAt)}</small>
                    </div>
                    <img className="proof-preview" src={item.result.screenshot} alt={`Capture de ${toDisplayName(item.player)}`} />
                  </article>
                ))}
              </div>
            </div>
          )}

          {!myResult && !['finished', 'dispute', 'cancelled'].includes(duel.status) && (
            <form className="panel form-panel" onSubmit={submitProof}>
            <div className="panel-head">
              <div>
                <p className="eyebrow">Preuve</p>
                <h2>Soumettre le résultat</h2>
              </div>
            </div>

            <label>
              Score final
              <input value={score} onChange={(event) => setScore(event.target.value)} placeholder="Ex: 3-2" required />
            </label>

            <label>
              Déclaration
              <select value={resultChoice} onChange={(event) => setResultChoice(event.target.value)}>
                <option value="win">Victoire</option>
                <option value="loss">Défaite</option>
              </select>
            </label>

            <label>
              Capture de fin de match
              <input type="file" accept="image/*" onChange={handleFile} required />
            </label>

            {screenshot && <img className="proof-preview" src={screenshot} alt="Prévisualisation de la capture de fin de match" />}
            {error && <p className="error">{error}</p>}
            <button type="submit" className="primary-button" disabled={submitting}>
              {submitting ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
              Envoyer la preuve
            </button>
            </form>
          )}

          {myResult && !['finished', 'dispute', 'cancelled'].includes(duel.status) && (
            <div className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Preuve</p>
                  <h2>Capture deja envoyee</h2>
                </div>
              </div>
              <p className="muted">La salle reste ouverte pendant que l'autre joueur envoie sa preuve ou que le verdict arrive.</p>
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
                <input value={chatDraft} onChange={(event) => setChatDraft(event.target.value)} placeholder="Message..." />
                <button type="submit" className="primary-button">
                  <MessageSquare size={16} aria-hidden="true" />
                </button>
              </form>
            </div>
            <p className="muted">Quand les deux preuves sont envoyées, le backend compare les captures et rend le verdict automatiquement ou ouvre un litige.</p>
          </div>
        </>
      )}
    </section>
  );
}

function ProfileView({ user, target, refreshTick, onOpenChallenge, onGoAdmin, onUserUpdate }) {
  const [profile, setProfile] = useState(target || user);
  const [recentDuels, setRecentDuels] = useState([]);
  const [editingStatus, setEditingStatus] = useState(user.status || 'available');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const targetId = target?._id || user._id;
    if (String(targetId) === String(user._id)) {
      setProfile(user);
      setEditingStatus(user.status || 'available');
      setRecentDuels([]);
      return;
    }

    api(`/users/${targetId}`)
      .then((data) => {
        setProfile(data.user);
        setRecentDuels(data.recentDuels || []);
      })
      .catch(() => {});
  }, [target?._id, user._id, refreshTick]);

  async function saveStatus() {
    setSaving(true);
    setError('');
    try {
      const data = await api('/users/profile', {
        method: 'PATCH',
        body: { status: editingStatus }
      });
      setProfile(data.user);
      onUserUpdate?.(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const isSelf = !target || String(target._id) === String(user._id);

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
              Admin
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
            <span className={toneClass(profile.status)}>{labelForStatus(profile.status)}</span>
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
        </div>
      </div>

      {isSelf ? (
        <div className="panel form-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Paramètres</p>
              <h2>Statut rapide</h2>
            </div>
          </div>
          <label>
            Disponibilité
            <select value={editingStatus} onChange={(event) => setEditingStatus(event.target.value)}>
              <option value="available">Disponible</option>
              <option value="online">En ligne</option>
              <option value="busy">Occupé</option>
              <option value="offline">Hors ligne</option>
            </select>
          </label>
          {error && <p className="error">{error}</p>}
          <button type="button" className="primary-button" onClick={saveStatus} disabled={saving}>
            {saving ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
            Enregistrer
          </button>
        </div>
      ) : (
        <div className="panel">
          <button type="button" className="primary-button" onClick={() => onOpenChallenge(profile)}>
            <Swords size={16} aria-hidden="true" />
            Défier
          </button>
        </div>
      )}

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
                  <small>{labelForStatus(duel.status)} · {duel.winner ? `Gagnant: ${toDisplayName(duel.winner)}` : 'Résultat en attente'}</small>
                </div>
                <span className="pill pill--neutral">{duel.matchType || 'Duel'}</span>
              </article>
            ))}
            {!recentDuels.length && <div className="empty-card">Aucun duel récent.</div>}
          </div>
        </div>
      )}
    </section>
  );
}

function AdminView({ refreshTick, onRefresh }) {
  const [data, setData] = useState({
    inbox: { items: [], counts: { total: 0, deposits: 0, withdrawals: 0, disputes: 0 } },
    deposits: [],
    withdrawals: [],
    disputes: []
  });
  const [note, setNote] = useState('');

  function load() {
    Promise.all([
      api('/admin/inbox'),
      api('/admin/deposits?status=pending'),
      api('/admin/withdrawals?status=pending'),
      api('/admin/disputes')
    ])
      .then(([inbox, deposits, withdrawals, disputes]) => {
        setData({
          inbox,
          deposits: deposits.deposits || [],
          withdrawals: withdrawals.withdrawals || [],
          disputes: disputes.disputes || []
        });
      })
      .catch(() => {});
  }

  useEffect(() => {
    load();
  }, [refreshTick]);

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
    await api(`/admin/disputes/${id}/resolve`, {
      method: 'POST',
      body: { action: 'winner', winnerId, reason: note }
    });
    setNote('');
    onRefresh();
    load();
  }

  return (
    <section className="page-stack">
      <div className="metric-grid">
        <article className="metric-card">
          <span>Boîte</span>
          <strong>{data.inbox?.counts?.total || 0}</strong>
        </article>
        <article className="metric-card">
          <span>Dépôts</span>
          <strong>{data.inbox?.counts?.deposits || 0}</strong>
        </article>
        <article className="metric-card metric-card--accent">
          <span>Litiges</span>
          <strong>{data.inbox?.counts?.disputes || 0}</strong>
        </article>
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
              </div>
              <div className="inline-actions">
                <button type="button" className="secondary-button" onClick={() => resolveDispute(duel._id, duel.player1?._id || duel.player1)}>J1 gagne</button>
                <button type="button" className="primary-button" onClick={() => resolveDispute(duel._id, duel.player2?._id || duel.player2)}>J2 gagne</button>
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
