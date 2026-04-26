import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import {
  Banknote,
  Bell,
  Crown,
  Eye,
  EyeOff,
  Gamepad2,
  History,
  LayoutDashboard,
  Lock,
  LogOut,
  Medal,
  MessageSquare,
  Search,
  Shield,
  Swords,
  Trophy,
  UserRound,
  Wallet
} from 'lucide-react';
import { API_URL, api, clearSession, getStoredUser, getToken, setSession } from './api.js';
import './styles.css';

const money = (value) => `${Number(value || 0).toLocaleString('fr-FR')} CFA`;

function timeAgo(value) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return '';
  const diffMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (diffMinutes < 1) return 'a l\'instant';
  if (diffMinutes < 60) return `${diffMinutes} min`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} j`;
}

function transactionLabel(type = '') {
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

function transactionTone(type = '') {
  if (['deposit', 'challenge_refund', 'duel_win'].includes(type)) return 'success';
  if (['withdraw', 'challenge_lock', 'duel_loss', 'commission'].includes(type)) return 'warning';
  if (type === 'admin_adjustment') return 'neutral';
  return 'neutral';
}

function transactionGroup(type = '') {
  if (['deposit', 'withdraw'].includes(type)) return 'wallet';
  if (['challenge_lock', 'challenge_refund', 'duel_win', 'duel_loss', 'commission'].includes(type)) return 'duel';
  if (type === 'admin_adjustment') return 'admin';
  return 'all';
}

async function loadSections(requests) {
  const entries = Object.entries(requests);
  const settled = await Promise.allSettled(entries.map(([, request]) => request()));
  const data = {};
  const errors = [];

  settled.forEach((result, index) => {
    const [key] = entries[index];
    if (result.status === 'fulfilled') {
      data[key] = result.value;
      return;
    }
    errors.push(result.reason?.message || `Impossible de charger ${key}`);
  });

  return { data, errors };
}

function App() {
  const [user, setUser] = useState(getStoredUser());
  const [view, setView] = useState(user ? 'dashboard' : 'landing');
  const [notice, setNotice] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [selectedDuel, setSelectedDuel] = useState(null);
  const [liveFeed, setLiveFeed] = useState([]);
  const [refreshTick, setRefreshTick] = useState(0);
  const refreshData = () => setRefreshTick((current) => current + 1);

  useEffect(() => {
    if (!user) return;
    api('/auth/me').catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const socket = io(API_URL.replace('/api', ''), { auth: { token: getToken() } });
    const push = (message) => {
      setNotice(message);
    };
    socket.on('challenge:new', (payload) => {
      push(`Nouveau défi: ${payload.amount} CFA`);
      setLiveFeed(prev => [{ type: 'challenge', text: `${payload.from} a lancé un défi de ${money(payload.amount)}`, time: Date.now() }, ...prev].slice(0, 10));
      refreshData();
    });
    socket.on('challenge:accepted', () => {
      push('Défi accepté. Duel actif.');
      refreshData();
    });
    socket.on('duel:finished', (payload) => {
      push('Duel terminé. Gains mis à jour.');
      setLiveFeed(prev => [{ type: 'win', text: `Duel terminé - Gains distribués`, time: Date.now() }, ...prev].slice(0, 10));
      refreshData();
    });
    socket.on('deposit:approved', (payload) => {
      push(`Dépôt validé: ${money(payload.amount)}`);
      setLiveFeed(prev => [{ type: 'deposit', text: `Dépôt de ${money(payload.amount)} validé`, time: Date.now() }, ...prev].slice(0, 10));
      refreshData();
    });
    socket.on('deposit:rejected', () => {
      push('Dépôt rejeté. Vérifie la note admin.');
      refreshData();
    });
    socket.on('withdrawal:approved', () => {
      push('Retrait validé par admin.');
      refreshData();
    });
    socket.on('wallet:updated', () => {
      refreshData();
    });
    socket.on('connect_error', (error) => {
      if (/auth|session|token/i.test(error.message || '')) {
        clearSession();
        setUser(null);
        setSelectedPlayer(null);
        setSelectedDuel(null);
        setLiveFeed([]);
        setNotice('Session expirée. Reconnecte-toi.');
        setView('login');
      }
    });
    return () => socket.disconnect();
  }, [user]);

  useEffect(() => {
    const handleAuthExpired = () => {
      clearSession();
      setUser(null);
      setSelectedPlayer(null);
      setSelectedDuel(null);
      setLiveFeed([]);
      setNotice('Session expirée. Reconnecte-toi.');
      setView('login');
    };

    window.addEventListener('skill2cash:auth-expired', handleAuthExpired);
    return () => window.removeEventListener('skill2cash:auth-expired', handleAuthExpired);
  }, []);

  const nav = useMemo(() => [
    ['dashboard', LayoutDashboard, 'Tableau de bord'],
    ['wallet', Wallet, 'Portefeuille'],
    ['players', Search, 'Joueurs'],
    ['duels', Swords, 'Duels'],
    ['leaderboard', Trophy, 'Classement'],
    ['history', History, 'Historique'],
    ...(user?.role === 'admin' ? [['admin', Shield, 'Admin']] : [])
  ], [user]);

  function logout() {
    clearSession();
    setUser(null);
    setSelectedPlayer(null);
    setSelectedDuel(null);
    setLiveFeed([]);
    setView('landing');
  }

  return (
    <main className="min-h-screen bg-cyber-black text-white">
      {notice && <div className="toast bg-cyber-card border border-cyber-primary/50 px-4 py-3 rounded-lg cursor-pointer hover:bg-cyber-dark transition-colors" onClick={() => setNotice('')}><Bell size={16} />{notice}</div>}
      <aside className="sidebar bg-cyber-dark border-r border-cyber-primary/20">
        <button className="brand hover:text-cyber-primary transition-colors" onClick={() => setView(user ? 'dashboard' : 'landing')} aria-label="Retour à l'accueil">
          <span className="brand-mark bg-gradient-to-r from-cyber-primary to-cyber-secondary bg-clip-text text-transparent">S2C</span>
          <span><strong className="text-white">SKILL2CASH</strong><small className="text-cyber-primary">NO SKILL. NO CASH.</small></span>
        </button>
        {user ? (
          <>
            <nav className="grid grid-cols-2 gap-3 p-4" aria-label="Navigation principale">
              {nav.map(([id, Icon, label]) => (
                <button key={id} className={`cyber-card flex flex-col items-center justify-center gap-2 ${view === id ? 'border-cyber-primary shadow-lg shadow-cyber-primary/30' : ''}`} onClick={() => setView(id)} aria-label={`Aller à ${label}`}>
                  <Icon size={24} className={view === id ? 'text-cyber-primary' : 'text-gray-300'} aria-hidden="true" />
                  <span className="text-sm font-medium">{label}</span>
                </button>
              ))}
            </nav>
            <div className="user-chip bg-cyber-card border border-cyber-primary/20 rounded-lg p-3 mx-4 mb-3">
              <UserRound size={18} className="text-cyber-primary" aria-hidden="true" />
              <span>{user.username}<small className="text-cyber-accent">{user.rank || 'Bronze'} joueur</small></span>
            </div>
            <div className="mx-4 mb-3 flex gap-2">
              <a href="https://wa.me/2250576459876" target="_blank" rel="noopener noreferrer" className="cyber-card flex-1 flex items-center justify-center gap-2 text-sm" aria-label="Rejoindre la communauté WhatsApp">
                💬 WhatsApp
              </a>
              <a href="#" target="_blank" rel="noopener noreferrer" className="cyber-card flex-1 flex items-center justify-center gap-2 text-sm" aria-label="Rejoindre le serveur Discord">
                🎮 Discord
              </a>
            </div>
            <button className="ghost mx-4 mb-4 text-cyber-danger hover:text-cyber-secondary transition-colors" onClick={logout} aria-label="Se déconnecter"><LogOut size={18} aria-hidden="true" />Déconnexion</button>
          </>
        ) : (
          <nav className="flex flex-col gap-2 p-4" aria-label="Navigation connexion">
            <button className={`cyber-card ${view === 'login' ? 'border-cyber-primary' : ''}`} onClick={() => setView('login')} aria-label="Se connecter"><Lock size={18} aria-hidden="true" />Connexion</button>
            <button className={`cyber-card ${view === 'register' ? 'border-cyber-primary' : ''}`} onClick={() => setView('register')} aria-label="Créer un compte"><UserRound size={18} aria-hidden="true" />Inscription</button>
          </nav>
        )}
      </aside>

      <section className="content">
        {view === 'landing' && <Landing setView={setView} />}
        {view === 'login' && <Auth mode="login" setUser={setUser} setView={setView} />}
        {view === 'register' && <Auth mode="register" setUser={setUser} setView={setView} />}
        {user && view === 'dashboard' && <Dashboard user={user} liveFeed={liveFeed} setView={setView} setSelectedDuel={setSelectedDuel} refreshTick={refreshTick} onRefresh={refreshData} />}
        {user && view === 'wallet' && <WalletView refreshTick={refreshTick} onRefresh={refreshData} />}
        {user && view === 'players' && <Players currentUser={user} setSelectedPlayer={setSelectedPlayer} setView={setView} />}
        {user && view === 'profile' && <PlayerProfile player={selectedPlayer} setView={setView} />}
        {user && view === 'duels' && <Duels setSelectedDuel={setSelectedDuel} setView={setView} refreshTick={refreshTick} onRefresh={refreshData} />}
        {user && view === 'duel-room' && <DuelRoom duelId={selectedDuel} user={user} setView={setView} onRefresh={refreshData} />}
        {user && view === 'leaderboard' && <Leaderboard />}
        {user && view === 'history' && <HistoryView refreshTick={refreshTick} />}
        {user && view === 'admin' && <Admin />}
      </section>
    </main>
  );
}

function Landing({ setView }) {
  return (
    <div className="landing">
      <div className="hero">
        <p className="eyebrow">eFootball money duels worldwide</p>
        <h1>SKILL2CASH</h1>
        <h2>NO SKILL. NO CASH.</h2>
        <p>Bienvenue sur SKILL2CASH, la plateforme où ton niveau eFootball devient ton argent. Défie des joueurs du monde entier, prouve ton skill, gagne tes duels et encaisse tes gains.</p>
        <div className="actions">
          <button onClick={() => setView('register')} aria-label="Créer un compte et commencer à jouer"><Gamepad2 size={18} aria-hidden="true" />Commencer à jouer</button>
          <button className="secondary" onClick={() => setView('login')} aria-label="Se connecter à son compte">Connexion</button>
        </div>
      </div>
      <div className="ticker" aria-hidden="true">
        {['PLAY HARD. WIN CASH.', 'ONLY SKILL PAYS.', 'YOU PLAY. YOU PROVE. YOU EARN.'].map((item) => <span key={item}>{item}</span>)}
      </div>
    </div>
  );
}

function Auth({ mode, setUser, setView }) {
  const [form, setForm] = useState({ username: '', email: '', password: '', country: 'Cote d Ivoire' });
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      const data = await api(`/auth/${mode}`, { method: 'POST', body: form });
      setSession(data);
      setUser(data.user);
      setView('dashboard');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form className="panel form" onSubmit={submit} aria-labelledby={`auth-${mode}-title`}>
      <h2 id={`auth-${mode}-title`}>{mode === 'login' ? 'Connexion' : 'Inscription'}</h2>
      {mode === 'register' && (
        <div>
          <label htmlFor="username" className="sr-only">Nom eFootball exact</label>
          <input id="username" placeholder="Nom eFootball exact" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required aria-required="true" />
        </div>
      )}
      <div>
        <label htmlFor="email" className="sr-only">Email</label>
        <input id="email" placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required aria-required="true" />
      </div>
      <div>
        <label htmlFor="password" className="sr-only">Mot de passe</label>
        <input id="password" placeholder="Mot de passe" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required aria-required="true" />
      </div>
      {mode === 'register' && (
        <div>
          <label htmlFor="country" className="sr-only">Pays</label>
          <input id="country" placeholder="Pays" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} required aria-required="true" />
        </div>
      )}
      {error && <p className="error text-cyber-danger" role="alert">{error}</p>}
      <button type="submit" className="cyber-button">{mode === 'login' ? 'Entrer dans l\'arène' : 'Créer un compte'}</button>
    </form>
  );
}

function Stat({ icon: Icon, label, value }) {
  return <div className="stat"><Icon size={20} aria-hidden="true" /><span>{label}<strong className="text-white">{value}</strong></span></div>;
}

function Dashboard({ user, liveFeed = [], setView, setSelectedDuel, refreshTick, onRefresh }) {
  const [wallet, setWallet] = useState(null);
  const [duels, setDuels] = useState([]);
  const [incomingChallenges, setIncomingChallenges] = useState([]);
  const [outgoingChallenges, setOutgoingChallenges] = useState([]);
  const [usernameRequest, setUsernameRequest] = useState({ requestedUsername: '', reason: '' });
  const [usernameMessage, setUsernameMessage] = useState('');
  const [dashboardMessage, setDashboardMessage] = useState('');
  const [hideBalance, setHideBalance] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      setLoading(true);
      setDashboardMessage('');
      try {
        const { data, errors } = await loadSections({
          wallet: () => api('/wallet'),
          duels: () => api('/duels'),
          incoming: () => api('/challenges/incoming'),
          outgoing: () => api('/challenges/outgoing')
        });
        if (!active) return;
        setWallet(data.wallet?.wallet);
        setDuels(data.duels?.duels || []);
        setIncomingChallenges(data.incoming?.challenges || []);
        setOutgoingChallenges(data.outgoing?.challenges || []);
        if (errors.length) setDashboardMessage(errors.join(' · '));
      } catch (error) {
        if (active) setDashboardMessage(error.message);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadDashboard();
    return () => {
      active = false;
    };
  }, [refreshTick]);

  const totalMatches = (user.wins || 0) + (user.losses || 0);
  const winRate = totalMatches > 0 ? Math.round(((user.wins || 0) / totalMatches) * 100) : 0;
  const levelProgress = Math.min(((user.totalEarnings || 0) / 100000) * 100, 100);
  const remainingForNextLevel = Math.max(100000 - (user.totalEarnings || 0), 0);
  const openDuels = duels.filter((duel) => !['finished', 'cancelled'].includes(duel.status));
  const pendingChallenges = incomingChallenges.filter((challenge) => ['pending', 'counter_offer'].includes(challenge.status));
  const pendingDeposits = wallet?.deposits?.filter((deposit) => deposit.status === 'pending').length || 0;
  const pendingWithdrawals = wallet?.withdrawals?.filter((withdrawal) => ['pending', 'approved'].includes(withdrawal.status)).length || 0;
  const activeStreak = user.currentStreak || 0;
  const maxStreak = user.maxStreak || 0;
  const progress = Math.round(levelProgress);
  const walletTotal = wallet?.balanceTotal || 0;

  const nextAction = pendingChallenges.length
    ? {
        label: 'Traiter les défis',
        hint: `${pendingChallenges.length} défi${pendingChallenges.length > 1 ? 's' : ''} en attente`,
        action: () => setView('duels')
      }
    : openDuels.length
      ? {
          label: 'Ouvrir un duel',
          hint: `${openDuels.length} salle${openDuels.length > 1 ? 's' : ''} active${openDuels.length > 1 ? 's' : ''}`,
          action: () => {
            setSelectedDuel(openDuels[0]._id);
            setView('duel-room');
          }
        }
      : {
        label: 'Trouver un adversaire',
        hint: 'Lancer une nouvelle mise',
        action: () => setView('players')
      };

  async function acceptChallenge(id) {
    setDashboardMessage('');
    try {
      await api(`/challenges/${id}/accept`, { method: 'POST' });
      await onRefresh?.();
      setView('duels');
    } catch (error) {
      setDashboardMessage(error.message);
    }
  }

  async function declineChallenge(id) {
    setDashboardMessage('');
    try {
      await api(`/challenges/${id}/decline`, { method: 'POST' });
      await onRefresh?.();
    } catch (error) {
      setDashboardMessage(error.message);
    }
  }

  async function cancelChallenge(id) {
    setDashboardMessage('');
    try {
      await api(`/challenges/${id}/cancel`, { method: 'POST' });
      await onRefresh?.();
    } catch (error) {
      setDashboardMessage(error.message);
    }
  }

  async function requestUsernameChange() {
    setUsernameMessage('');
    try {
      await api('/users/username-change-requests', { method: 'POST', body: usernameRequest });
      setUsernameRequest({ requestedUsername: '', reason: '' });
      setUsernameMessage('Demande envoyee. Un admin doit valider avant tout changement.');
    } catch (error) {
      setUsernameMessage(error.message);
    }
  }

  return (
    <div className="stack">
      <header className="page-head">
        <span>
          <p className="eyebrow">Vue principale</p>
          <h1>Tableau de bord</h1>
        </span>
        <div className="actions">
          <button onClick={() => setView('players')} className="cyber-button" aria-label="Trouver un adversaire pour un duel">
            <Swords size={18} aria-hidden="true" />Trouver un joueur
          </button>
          <button onClick={() => setView('wallet')} className="secondary" aria-label="Ouvrir le portefeuille">
            <Wallet size={18} aria-hidden="true" />Portefeuille
          </button>
        </div>
      </header>

      <section className="panel dashboard-hero">
        <div className="dashboard-hero-copy">
          <p className="eyebrow">Action immédiate</p>
          <h2>{nextAction.label}</h2>
          <p className="muted">{nextAction.hint}</p>
          <div className="actions">
            <button onClick={nextAction.action} className="cyber-button" aria-label={nextAction.label}>
              <Gamepad2 size={18} aria-hidden="true" />{nextAction.label}
            </button>
            <button onClick={() => setView('duels')} className="secondary" aria-label="Voir toutes les salles et défis">
              <Swords size={18} aria-hidden="true" />Tous les duels
            </button>
          </div>
          {dashboardMessage && <p className="muted">{dashboardMessage}</p>}
        </div>
        <div className="dashboard-hero-side">
          <div className="summary-stack">
            <div className="summary-line">
              <span>Joueur</span>
              <strong>{user.username}</strong>
            </div>
            <div className="summary-line">
              <span>Niveau</span>
              <strong>{user.rank || 'Bronze'}</strong>
            </div>
            <div className="summary-line">
              <span>Série</span>
              <strong>{activeStreak} / {maxStreak}</strong>
            </div>
            <div className="summary-line">
              <span>Disponible</span>
              <strong>{hideBalance ? '••••••' : money(wallet?.balanceAvailable)}</strong>
            </div>
            <div className="summary-line">
              <span>Bloqué</span>
              <strong>{hideBalance ? '••••••' : money(wallet?.balanceLocked)}</strong>
            </div>
            <div className="summary-line">
              <span>Total</span>
              <strong>{hideBalance ? '••••••' : money(walletTotal)}</strong>
            </div>
            <div className="summary-line">
              <span>En validation</span>
              <strong>{pendingDeposits + pendingWithdrawals}</strong>
            </div>
          </div>
          <div className="progress-card">
            <div className="summary-line">
              <span>Progression vers le prochain rang</span>
              <strong>{progress}%</strong>
            </div>
            <div className="progress-track" aria-hidden="true">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <small className="text-gray-300">
              {remainingForNextLevel > 0 ? `${money(remainingForNextLevel)} à gagner pour le prochain palier` : 'Palier maximal atteint'}
            </small>
          </div>
        </div>
      </section>

      <div className="grid stats">
        <Stat icon={Wallet} label="Disponible" value={hideBalance ? '••••••' : money(wallet?.balanceAvailable)} />
        <Stat icon={Lock} label="Bloqué" value={hideBalance ? '••••••' : money(wallet?.balanceLocked)} />
        <Stat icon={Banknote} label="Total" value={hideBalance ? '••••••' : money(walletTotal)} />
        <Stat icon={Banknote} label="Gagné" value={hideBalance ? '••••••' : money(wallet?.totalWon)} />
        <Stat icon={Bell} label="Défis" value={pendingChallenges.length + outgoingChallenges.length} />
        <Stat icon={Crown} label="Duels actifs" value={openDuels.length} />
        <Stat icon={Medal} label="Taux de victoire" value={`${winRate}%`} />
      </div>
      {loading && <section className="panel"><p className="muted">Chargement du tableau de bord...</p></section>}

      <div className="flex items-center gap-2">
        <button onClick={() => setHideBalance(!hideBalance)} className="secondary" aria-label={hideBalance ? 'Afficher le solde' : 'Masquer le solde'}>
          {hideBalance ? <><Eye size={18} aria-hidden="true" />Afficher le solde</> : <><EyeOff size={18} aria-hidden="true" />Masquer le solde</>}
        </button>
        <span className="muted">
          {pendingDeposits > 0 ? `${pendingDeposits} dépôt${pendingDeposits > 1 ? 's' : ''} en attente` : 'Aucun dépôt en attente'}
          {' · '}
          {pendingWithdrawals > 0 ? `${pendingWithdrawals} retrait${pendingWithdrawals > 1 ? 's' : ''} à traiter` : 'Aucun retrait en attente'}
        </span>
      </div>

      <div className="grid two">
        <section className="panel" aria-labelledby="incoming-challenges-title">
          <h2 id="incoming-challenges-title">Défis reçus</h2>
          <DataList rows={pendingChallenges.slice(0, 5)} empty="Aucun défi à traiter" render={(challenge) => (
            <div className="row">
              <span>
                {challenge.challenger?.username}
                <small className="text-gray-300">{challenge.status} · {money(challenge.amount)} · {timeAgo(challenge.createdAt)}</small>
              </span>
              <button type="button" onClick={() => acceptChallenge(challenge._id)} className="cyber-button">Accepter</button>
              <button type="button" onClick={() => declineChallenge(challenge._id)} className="danger">Refuser</button>
            </div>
          )} />
        </section>
        <section className="panel" aria-labelledby="active-duels-title">
          <h2 id="active-duels-title">Duels actifs</h2>
          <DataList rows={openDuels.slice(0, 5)} empty="Aucun duel pour le moment" render={(duel) => (
            <button type="button" className="row" onClick={() => { setSelectedDuel(duel._id); setView('duel-room'); }} aria-label={`Rejoindre le duel entre ${duel.player1?.username} et ${duel.player2?.username}`}>
              <span>
                {duel.player1?.username} vs {duel.player2?.username}
                <small className="text-gray-300">{duel.status} · {timeAgo(duel.createdAt)}</small>
              </span>
              <strong className="text-white">{money(duel.potTotal)}</strong>
            </button>
          )} />
        </section>
      </div>

      <section className="panel" aria-labelledby="sent-challenges-title">
        <h2 id="sent-challenges-title">Défis envoyés</h2>
        <DataList rows={outgoingChallenges.slice(0, 5)} empty="Aucun défi envoyé" render={(challenge) => (
          <div className="row">
            <span>
              {challenge.challenged?.username}
              <small className="text-gray-300">{challenge.status} · {money(challenge.amount)}</small>
            </span>
            <strong className="text-white">{timeAgo(challenge.createdAt)}</strong>
            {challenge.status === 'pending' && (
              <button type="button" onClick={() => cancelChallenge(challenge._id)} className="secondary">
                Annuler
              </button>
            )}
          </div>
        )} />
      </section>

      <section className="panel" aria-labelledby="live-feed-title">
        <h2 id="live-feed-title" className="section-title"><span aria-hidden="true">●</span> Flux temps réel</h2>
        {liveFeed.length > 0 ? (
          <div className="list">
            {liveFeed.map((item, index) => (
              <div key={index} className="row">
                <span>
                  {item.text}
                  <small className="text-gray-300">{timeAgo(item.time)}</small>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <strong>Aucune activité récente</strong>
            <small className="text-gray-300">Les nouveaux défis, dépôts validés et fins de duel apparaîtront ici.</small>
          </div>
        )}
      </section>

      <section className="panel form" aria-labelledby="username-title">
        <h2 id="username-title">Nom eFootball officiel</h2>
        <p className="muted">Ton username SKILL2CASH doit etre identique a ton nom dans eFootball pour permettre la validation OCR.</p>
        <input value={user?.username || ''} disabled aria-label="Nom d'utilisateur actuel" />
        <input placeholder="Nouveau nom eFootball exact" value={usernameRequest.requestedUsername} onChange={(e) => setUsernameRequest({ ...usernameRequest, requestedUsername: e.target.value })} />
        <textarea placeholder="Raison de la demande" value={usernameRequest.reason} onChange={(e) => setUsernameRequest({ ...usernameRequest, reason: e.target.value })} />
        <button onClick={requestUsernameChange} type="button">Demander validation admin</button>
        {usernameMessage && <p className="muted">{usernameMessage}</p>}
      </section>
    </div>
  );
}

function WalletView({ refreshTick, onRefresh }) {
  const [state, setState] = useState(null);
  const [depositForm, setDepositForm] = useState({
    method: 'wave',
    amount: 5000,
    senderName: '',
    senderPhone: '',
    transactionReference: '',
    screenshotUrl: ''
  });
  const [withdraw, setWithdraw] = useState({ amount: 3000, method: 'Mobile Money', phoneOrWallet: '' });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const result = await api('/wallet');
      setState(result);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [refreshTick]);

  const pendingDeposits = state?.deposits?.filter((deposit) => deposit.status === 'pending').length || 0;
  const pendingWithdrawals = state?.withdrawals?.filter((withdrawal) => ['pending', 'approved'].includes(withdrawal.status)).length || 0;
  const lastDeposit = state?.deposits?.[0];
  const lastWithdrawal = state?.withdrawals?.[0];
  const walletTotal = state?.wallet ? (state.wallet.balanceTotal || state.wallet.balanceAvailable + state.wallet.balanceLocked) : 0;

  function updateDeposit(field, value) {
    setDepositForm((current) => ({ ...current, [field]: value }));
  }

  function readScreenshot(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMessage('La preuve doit être une image.');
      return;
    }
    if (file.size > 750 * 1024) {
      setMessage('Image trop lourde. Maximum 750KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => updateDeposit('screenshotUrl', reader.result);
    reader.readAsDataURL(file);
  }

  async function deposit() {
    setMessage('');
    try {
      const data = await api('/wallet/deposit', {
        method: 'POST',
        body: { ...depositForm, amount: Number(depositForm.amount) }
      });
      setMessage(data.message);
      setDepositForm({ method: depositForm.method, amount: 5000, senderName: '', senderPhone: '', transactionReference: '', screenshotUrl: '' });
      await load();
      onRefresh?.();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function requestWithdraw() {
    setMessage('');
    try {
      await api('/wallet/withdraw', { method: 'POST', body: { ...withdraw, amount: Number(withdraw.amount) } });
      await load();
      onRefresh?.();
      setMessage('Demande de retrait envoyee.');
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <div className="stack">
      <header className="page-head">
        <span>
          <p className="eyebrow">Portefeuille interne</p>
          <h1>Portefeuille</h1>
        </span>
        <p className="muted">Les soldes disponibles, bloques et en attente sont séparés pour éviter toute confusion.</p>
      </header>
      <div className="grid stats">
        <Stat icon={Wallet} label="Disponible" value={money(state?.wallet?.balanceAvailable)} />
        <Stat icon={Lock} label="Bloqué" value={money(state?.wallet?.balanceLocked)} />
        <Stat icon={Banknote} label="Total" value={money(walletTotal)} />
        <Stat icon={Banknote} label="Déposé" value={money(state?.wallet?.totalDeposited)} />
        <Stat icon={Bell} label="Dépôts en attente" value={pendingDeposits} />
      </div>
      <section className="panel">
        <h2>Lecture rapide</h2>
        <div className="summary-stack">
          <div className="summary-line">
            <span>Disponible</span>
            <strong>{money(state?.wallet?.balanceAvailable)}</strong>
          </div>
          <div className="summary-line">
            <span>Bloqué</span>
            <strong>{money(state?.wallet?.balanceLocked)}</strong>
          </div>
          <div className="summary-line">
            <span>Total réel</span>
            <strong>{money(walletTotal)}</strong>
          </div>
          <div className="summary-line">
            <span>Validation</span>
            <strong>{pendingDeposits + pendingWithdrawals}</strong>
          </div>
        </div>
        <small className="text-gray-300">Les dépôts n'entrent dans le solde utilisable qu'après validation manuelle. Les retraits restent visibles tant qu'ils n'ont pas quitté la file de traitement.</small>
      </section>
      <section className="panel">
        <h2>Lecture rapide des fonds</h2>
        <div className="list">
          <div className="row"><span>Disponible<small className="text-gray-300">Utilisable pour un nouveau défi ou un retrait</small></span><strong className="text-white">Immédiat</strong></div>
          <div className="row"><span>Bloqué<small className="text-gray-300">Mises immobilisées pendant un duel en cours</small></span><strong className="text-white">Duel</strong></div>
          <div className="row"><span>En attente<small className="text-gray-300">Dépôt non crédité tant qu'un admin ne valide pas</small></span><strong className="text-white">Admin</strong></div>
        </div>
      </section>
      <section className="panel">
        <h2>Dernières opérations</h2>
        <div className="summary-stack">
          <div className="summary-line">
            <span>Dernier dépôt</span>
            <strong>{lastDeposit ? `${money(lastDeposit.amount)} · ${lastDeposit.status}` : 'Aucun dépôt récent'}</strong>
          </div>
          <div className="summary-line">
            <span>Dernier retrait</span>
            <strong>{lastWithdrawal ? `${money(lastWithdrawal.amount)} · ${lastWithdrawal.status}` : 'Aucun retrait récent'}</strong>
          </div>
        </div>
      </section>
      <div className="grid two">
        <section className="panel form" aria-labelledby="deposit-title">
          <h2 id="deposit-title">Dépôt manuel</h2>
          <div className="method-switch" role="radiogroup" aria-label="Choisir la méthode de paiement">
            {Object.values(state?.paymentAccounts || {}).map((account) => (
              <button
                key={account.method}
                type="button"
                className={depositForm.method === account.method ? 'active' : ''}
                onClick={() => updateDeposit('method', account.method)}
                aria-label={`Choisir ${account.label}`}
                role="radio"
                aria-checked={depositForm.method === account.method}
              >
                {account.label}
              </button>
            ))}
          </div>
          <PaymentInstructions account={state?.paymentAccounts?.[depositForm.method]} />
          <label htmlFor="deposit-amount" className="sr-only">Montant envoyé</label>
          <input id="deposit-amount" type="number" value={depositForm.amount} onChange={(e) => updateDeposit('amount', e.target.value)} placeholder="Montant envoyé" required aria-required="true" />
          <label htmlFor="deposit-sender" className="sr-only">Nom de l'expéditeur</label>
          <input id="deposit-sender" value={depositForm.senderName} onChange={(e) => updateDeposit('senderName', e.target.value)} placeholder="Nom de l'expéditeur" required aria-required="true" />
          <label htmlFor="deposit-phone" className="sr-only">Numéro de l'expéditeur</label>
          <input id="deposit-phone" value={depositForm.senderPhone} onChange={(e) => updateDeposit('senderPhone', e.target.value)} placeholder="Numéro de l'expéditeur" required aria-required="true" />
          <label htmlFor="deposit-ref" className="sr-only">Référence transaction optionnelle</label>
          <input id="deposit-ref" value={depositForm.transactionReference} onChange={(e) => updateDeposit('transactionReference', e.target.value)} placeholder="Référence transaction optionnelle" />
          <label htmlFor="deposit-proof" className="sr-only">Preuve de paiement (capture d'écran)</label>
          <input id="deposit-proof" type="file" accept="image/*" onChange={(e) => readScreenshot(e.target.files?.[0])} aria-label="Télécharger la preuve de paiement" />
          {depositForm.screenshotUrl && <img className="proof-preview" src={depositForm.screenshotUrl} alt="Preuve de paiement" />}
          <button onClick={deposit} className="cyber-button" type="button" aria-label="Envoyer le dépôt pour validation admin" disabled={loading}>Envoyer pour validation</button>
          {message && <p className="muted text-gray-300" role="status">{message}</p>}
        </section>
        <section className="panel form" aria-labelledby="withdraw-title">
          <h2 id="withdraw-title">Demande de retrait</h2>
          <label htmlFor="withdraw-amount" className="sr-only">Montant à retirer</label>
          <input id="withdraw-amount" type="number" value={withdraw.amount} onChange={(e) => setWithdraw({ ...withdraw, amount: e.target.value })} placeholder="Montant à retirer" required aria-required="true" />
          <label htmlFor="withdraw-method" className="sr-only">Méthode de retrait</label>
          <select id="withdraw-method" value={withdraw.method} onChange={(e) => setWithdraw({ ...withdraw, method: e.target.value })}>
            <option>Mobile Money</option>
            <option>Crypto</option>
            <option>Bank</option>
            <option>Manuel</option>
          </select>
          <label htmlFor="withdraw-wallet" className="sr-only">Téléphone ou portefeuille</label>
          <input id="withdraw-wallet" placeholder="Téléphone ou portefeuille" value={withdraw.phoneOrWallet} onChange={(e) => setWithdraw({ ...withdraw, phoneOrWallet: e.target.value })} required aria-required="true" />
          <button onClick={requestWithdraw} className="cyber-button" type="button" aria-label="Demander un retrait du portefeuille" disabled={loading}>Demander un retrait</button>
        </section>
      </div>
      <section className="panel" aria-labelledby="deposits-title">
        <h2 id="deposits-title">Historique des dépôts</h2>
        <DataList rows={state?.deposits} empty="Aucun dépôt" render={(d) => (
          <div className="row">
            <span>{d.method.toUpperCase()} · {d.senderName}<small className="text-gray-300">{d.status} · {timeAgo(d.createdAt)} {d.adminNote ? `· ${d.adminNote}` : ''}</small></span>
            <strong className="text-white">{money(d.amount)}</strong>
            <b className={`status-pill status-pill--${d.status === 'approved' ? 'success' : d.status === 'rejected' ? 'danger' : 'warning'}`}>{d.status}</b>
          </div>
        )} />
      </section>
      <section className="panel" aria-labelledby="withdrawals-title">
        <h2 id="withdrawals-title">Demandes de retrait</h2>
        <DataList rows={state?.withdrawals} empty="Aucun retrait" render={(item) => (
          <div className="row">
            <span>
              {item.method}
              <small className="text-gray-300">{item.phoneOrWallet} · {item.status} · {timeAgo(item.createdAt)}</small>
            </span>
            <strong className="text-white">{money(item.amount)}</strong>
            <b className={`status-pill status-pill--${item.status === 'paid' || item.status === 'approved' ? 'success' : item.status === 'rejected' ? 'danger' : 'warning'}`}>{item.status}</b>
          </div>
        )} />
      </section>
    </div>
  );
}

function PaymentInstructions({ account }) {
  if (!account) return null;
  return (
    <div className="instructions">
      <b>{account.label}</b>
      <p>Numéro: <strong>{account.paymentNumber}</strong></p>
      <p>Compte: <strong>{account.accountName}</strong></p>
      <small>Vérification estimée: {account.estimatedDelay}</small>
      {account.instructions.map((item) => <small key={item}>{item}</small>)}
    </div>
  );
}

function Players({ currentUser, setSelectedPlayer, setView }) {
  const [players, setPlayers] = useState([]);
  const [q, setQ] = useState('');
  const [country, setCountry] = useState('');
  const [onlineOnly, setOnlineOnly] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load(nextFilters = {}) {
    const nextOnlineOnly = nextFilters.onlineOnly ?? onlineOnly;
    const params = new URLSearchParams({
      q: nextFilters.q ?? q,
      online: String(nextOnlineOnly),
      excludeId: currentUser?._id || '',
      ...(nextFilters.country ? { country: nextFilters.country } : country ? { country } : {})
    });
    setLoading(true);
    setError('');
    try {
      setPlayers((await api('/users/search?' + params)).users);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load({ onlineOnly: true });
  }, [currentUser]);

  function resetFilters() {
    setQ('');
    setCountry('');
    setOnlineOnly(true);
    load({ q: '', country: '', onlineOnly: true });
  }

  return (
    <div className="stack">
      <header className="page-head">
        <span>
          <p className="eyebrow">Recherche de joueurs</p>
          <h1>Rechercher des joueurs</h1>
        </span>
        <p className="muted">{players.length} profil{players.length > 1 ? 's' : ''} visible{players.length > 1 ? 's' : ''}</p>
      </header>
      <section className="filters">
        <input placeholder="Pseudo exact ou partiel" value={q} onChange={(e) => setQ(e.target.value)} />
        <input placeholder="Pays" value={country} onChange={(e) => setCountry(e.target.value)} />
        <button type="button" className={onlineOnly ? 'active' : 'secondary'} onClick={() => {
          const next = !onlineOnly;
          setOnlineOnly(next);
          load({ onlineOnly: next });
        }}>
          {onlineOnly ? 'En ligne' : 'Tous'}
        </button>
        <button type="button" onClick={load}><Search size={18} />Rechercher</button>
        <button type="button" className="secondary" onClick={resetFilters}>R?initialiser</button>
      </section>
      {error && <section className="panel"><p className="error">{error}</p></section>}
      {loading && <section className="panel"><p className="muted">Recherche des joueurs...</p></section>}
      {!loading && !error && (
        <section className="panel">
          <p className="muted">
            {onlineOnly ? 'Joueurs actuellement connect?s' : 'Tous les joueurs actifs'} ? {players.length} profil{players.length > 1 ? 's' : ''} trouv?{players.length > 1 ? 's' : ''}
          </p>
        </section>
      )}
      <div className="player-grid">
        {players.map((player) => <PlayerCard key={player._id} player={player} onClick={() => { setSelectedPlayer(player); setView('profile'); }} />)}
      </div>
    </div>
  );
}

function PlayerCard({ player, onClick }) {
  const minStake = money(player.minStake);
  const maxStake = money(player.maxStake);
  return (
    <button className="player-card" type="button" onClick={onClick}>
      <img src={player.avatar || `https://api.dicebear.com/9.x/bottts/svg?seed=${player.username}`} alt="" />
      <span>
        <strong>{player.username}</strong>
        <small>{player.country} · {player.level}</small>
      </span>
      <b>{player.rank}</b>
      <small>{player.wins}V / {player.losses}D · {player.winRate}%</small>
      <small>Fiabilité {player.reputation || 0}/100 · {player.status}</small>
      <small>Mise {minStake} - {maxStake}</small>
    </button>
  );
}

function PlayerProfile({ player, setView }) {
  const [amount, setAmount] = useState(player?.minStake || 1000);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('');
  if (!player) return <p>Sélectionnez un joueur.</p>;

  async function challenge() {
    try {
      await api('/challenges', { method: 'POST', body: { challengedId: player._id, amount: Number(amount), message } });
      setStatus('Défi envoyé.');
    } catch (err) {
      setStatus(err.message);
    }
  }

  return (
    <div className="stack">
      <section className="profile">
        <img src={player.avatar || `https://api.dicebear.com/9.x/bottts/svg?seed=${player.username}`} alt="" />
        <div>
          <p className="eyebrow">{player.status}</p>
          <h1>{player.username}</h1>
          <p>{player.country} · {player.level} · {player.badge}</p>
          <p className="muted">Mise minimale {money(player.minStake)} · mise maximale {money(player.maxStake)}</p>
        </div>
      </section>
      <div className="grid stats">
        <Stat icon={Trophy} label="Victoires" value={player.wins} />
        <Stat icon={Medal} label="Taux de victoire" value={`${player.winRate}%`} />
        <Stat icon={Banknote} label="Gains" value={money(player.totalEarnings)} />
        <Stat icon={Shield} label="Réputation" value={player.reputation || 0} />
      </div>
      <section className="panel form">
        <h2>Défier ce joueur</h2>
        <input type="number" min={player.minStake} max={player.maxStake} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <textarea placeholder="Message optionnel" value={message} onChange={(e) => setMessage(e.target.value)} />
        <button onClick={challenge} type="button"><Swords size={18} />Envoyer un défi</button>
        {status && <p className="muted">{status}</p>}
      </section>
      <button className="secondary" type="button" onClick={() => setView('players')}>Retour</button>
    </div>
  );
}

function Duels({ setSelectedDuel, setView, refreshTick, onRefresh }) {
  const [duels, setDuels] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const [d, i, o] = await Promise.all([api('/duels'), api('/challenges/incoming'), api('/challenges/outgoing')]);
      setDuels(d.duels); setIncoming(i.challenges); setOutgoing(o.challenges);
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => { load(); }, [refreshTick]);

  async function accept(id) { await api(`/challenges/${id}/accept`, { method: 'POST' }); await load(); onRefresh?.(); }
  async function decline(id) { await api(`/challenges/${id}/decline`, { method: 'POST' }); await load(); onRefresh?.(); }

  return (
    <div className="stack">
      <header className="page-head">
        <span>
          <p className="eyebrow">Défis et salles</p>
          <h1>Duels</h1>
        </span>
        <p className="muted">{incoming.length} reçu{incoming.length > 1 ? 's' : ''} · {outgoing.length} envoyé{outgoing.length > 1 ? 's' : ''} · {duels.length} salle{duels.length > 1 ? 's' : ''}</p>
      </header>
      {error && <section className="panel"><p className="error">{error}</p></section>}
      <div className="grid two">
        <section className="panel" aria-labelledby="challenges-received-title">
          <h2 id="challenges-received-title">Reçus</h2>
          <DataList rows={incoming} empty="Aucun défi reçu" render={(c) => (
            <div className="row">
              <span>{c.challenger?.username}<small className="text-gray-300">{c.status}</small></span>
              <strong className="text-white">{money(c.amount)}</strong>
              <button type="button" onClick={() => accept(c._id)} className="cyber-button" aria-label={`Accepter le défi de ${c.challenger?.username} pour ${money(c.amount)}`}>Accepter</button>
              <button type="button" className="danger" onClick={() => decline(c._id)} aria-label={`Refuser le défi de ${c.challenger?.username}`}>Refuser</button>
            </div>
          )} />
        </section>
        <section className="panel" aria-labelledby="challenges-sent-title">
          <h2 id="challenges-sent-title">Envoyés</h2>
          <DataList rows={outgoing} empty="Aucun défi envoyé" render={(c) => (
            <div className="row">
              <span>{c.challenged?.username}<small className="text-gray-300">{c.status}</small></span>
              <strong className="text-white">{money(c.amount)}</strong>
            </div>
          )} />
        </section>
      </div>
      <section className="panel" aria-labelledby="duel-rooms-title">
        <h2 id="duel-rooms-title">Salles</h2>
        <DataList rows={duels} empty="Aucune salle de duel" render={(d) => (
          <button type="button" className="row" onClick={() => { setSelectedDuel(d._id); setView('duel-room'); }} aria-label={`Rejoindre la salle de duel entre ${d.player1?.username} et ${d.player2?.username}`}>
            <span>{d.player1?.username} vs {d.player2?.username}<small className="text-gray-300">{d.status}</small></span>
            <strong className="text-white">{money(d.potTotal)}</strong>
          </button>
        )} />
      </section>
    </div>
  );
}

function DuelRoom({ duelId, user, setView, onRefresh }) {
  const [duel, setDuel] = useState(null);
  const [form, setForm] = useState({ score: '', declaredWinner: '', screenshot: '', comment: '' });
  const [chat, setChat] = useState([]);
  const [message, setMessage] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const socketRef = useRef(null);

  useEffect(() => {
    if (!duelId) return;
    setChat([]);
    setActionMessage('');
    setMessage('');
    api(`/duels/${duelId}`).then(({ duel }) => {
      setDuel(duel);
      setForm((current) => ({ ...current, declaredWinner: duel.player1?._id }));
    });
  }, [duelId]);

  useEffect(() => {
    if (!duel?.roomId) return;
    const socket = io(API_URL.replace('/api', ''), { auth: { token: getToken() } });
    socketRef.current = socket;
    socket.emit('duel:join', duel.roomId);
    socket.on('duel:message', (msg) => setChat((items) => [...items, msg]));
    return () => {
      socketRef.current = null;
      socket.disconnect();
    };
  }, [duel?.roomId]);

  async function submitResult() {
    try {
      const data = await api(`/duels/${duelId}/result`, { method: 'POST', body: form });
      setDuel(data.duel);
      setActionMessage('Résultat envoyé.');
      onRefresh?.();
    } catch (error) {
      setActionMessage(error.message);
    }
  }

  function readResultScreenshot(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setForm((current) => ({ ...current, screenshot: reader.result }));
    reader.readAsDataURL(file);
  }

  function send() {
    socketRef.current?.emit('duel:message', { roomId: duel.roomId, message });
    setMessage('');
  }

  if (!duel) return <p className="muted">Ouvrez une salle de duel.</p>;

  const isFinished = duel.status === 'finished';
  const opponent = duel.player1?._id === user?._id ? duel.player2 : duel.player1;
  const isParticipant = String(duel.player1?._id) === String(user?._id) || String(duel.player2?._id) === String(user?._id);
  const nextStep = isFinished
    ? 'Le duel est termine. Vous pouvez lancer une revanche.'
    : duel.status === 'dispute'
      ? 'Le duel est en litige. Attendez la résolution admin.'
      : 'Soumettez le score et la capture pour valider le match.';

  async function quickRematch() {
    try {
      await api('/challenges', {
        method: 'POST',
        body: {
          challengedId: opponent._id,
          amount: duel.amount,
          matchType: duel.matchType,
          rules: duel.rules
        }
      });
      onRefresh?.();
      setView('duels');
    } catch (err) {
      setActionMessage(err.message);
    }
  }

  return (
    <div className="stack">
      <header className="page-head">
        <span>
          <p className="eyebrow">Salle de match privée</p>
          <h1>{duel.player1?.username} vs {duel.player2?.username}</h1>
          <p className="muted">{nextStep}</p>
        </span>
        <b className={isFinished ? 'text-cyber-accent' : 'text-cyber-primary'}>{duel.status}</b>
      </header>
      <section className="panel">
        <div className="grid stats">
          <Stat icon={Banknote} label="Pot total" value={money(duel.potTotal)} />
          <Stat icon={Shield} label="Commission" value={money(duel.commissionAmount)} />
          <Stat icon={Trophy} label="Gagnant reçoit" value={money(duel.winnerAmount)} />
          {isFinished && <Stat icon={Medal} label="Gain net" value={money(duel.winnerAmount - duel.commissionAmount)} />}
        </div>
        <div className="grid two" style={{ marginTop: 12 }}>
          <div className="summary-stack">
            <div className="summary-line"><span>Vous</span><strong>{user?.username}</strong></div>
            <div className="summary-line"><span>Adversaire</span><strong>{opponent?.username || 'N/A'}</strong></div>
            <div className="summary-line"><span>Votre place</span><strong>{isParticipant ? 'Participant' : 'Observateur'}</strong></div>
          </div>
          <div className="summary-stack">
            <div className="summary-line"><span>Votre mise</span><strong>{money(duel.amount)}</strong></div>
            <div className="summary-line"><span>Statut OCR</span><strong>{duel.autoValidationStatus}</strong></div>
            <div className="summary-line"><span>Confiance</span><strong>{Math.max(duel.ocrConfidencePlayer1 || 0, duel.ocrConfidencePlayer2 || 0)}%</strong></div>
          </div>
        </div>
      </section>
      {isFinished && (
        <div className="cyber-card text-center">
          <p className="text-cyber-accent font-bold text-lg mb-2">Duel terminé</p>
          <button type="button" onClick={quickRematch} className="cyber-button" aria-label="Lancer une revanche instantanée">
            Revanche instantanee
          </button>
        </div>
      )}
      <div className="grid two">
        <section className="panel form" aria-labelledby="submit-result-title">
          <h2 id="submit-result-title">Soumettre le résultat</h2>
          <label htmlFor="result-score" className="sr-only">Score final ex: 3-1</label>
          <input id="result-score" placeholder="Score final ex: 3-1" value={form.score} onChange={(e) => setForm({ ...form, score: e.target.value })} required aria-required="true" disabled={isFinished} />
          <label htmlFor="result-winner" className="sr-only">Gagnant du match</label>
          <select id="result-winner" value={form.declaredWinner} onChange={(e) => setForm({ ...form, declaredWinner: e.target.value })} disabled={isFinished}>
            <option value={duel.player1?._id}>{duel.player1?.username}</option>
            <option value={duel.player2?._id}>{duel.player2?.username}</option>
          </select>
          <label htmlFor="result-screenshot" className="sr-only">Capture d'écran du résultat</label>
          <input id="result-screenshot" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => readResultScreenshot(e.target.files?.[0])} aria-label="Télécharger la capture d'écran du résultat" disabled={isFinished} />
          {form.screenshot && <img className="proof-preview" src={form.screenshot} alt="Capture resultat" />}
          <label htmlFor="result-comment" className="sr-only">Commentaire sur le match</label>
          <textarea id="result-comment" placeholder="Commentaire" value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} disabled={isFinished} />
          <button type="button" onClick={submitResult} className="cyber-button" aria-label="Soumettre le résultat du match pour validation" disabled={isFinished}>Soumettre le résultat</button>
          {actionMessage && <p className="muted">{actionMessage}</p>}
        </section>
        <section className="panel chat" aria-labelledby="chat-title">
          <h2 id="chat-title"><MessageSquare size={18} aria-hidden="true" />Chat du match</h2>
          <div className="chat-log" role="log" aria-live="polite">
            {chat.map((m, i) => <p key={i}><b className="text-cyber-primary">{m.userId}</b> <span className="text-gray-300">{m.message}</span></p>)}
          </div>
          <div className="inline">
            <label htmlFor="chat-message" className="sr-only">Message</label>
            <input id="chat-message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Message" />
            <button type="button" onClick={send} aria-label="Envoyer le message" disabled={!message.trim()}>Envoyer</button>
          </div>
        </section>
      </div>
      <section className="panel" aria-labelledby="ocr-validation-title">
        <h2 id="ocr-validation-title">Validation OCR</h2>
        <div className="grid two">
          <OcrCard title={duel.player1?.username} score={duel.ocrScorePlayer1} confidence={duel.ocrConfidencePlayer1} players={duel.ocrPlayersDetectedPlayer1} text={duel.ocrTextPlayer1} />
          <OcrCard title={duel.player2?.username} score={duel.ocrScorePlayer2} confidence={duel.ocrConfidencePlayer2} players={duel.ocrPlayersDetectedPlayer2} text={duel.ocrTextPlayer2} />
        </div>
        <p className="muted">{duel.autoValidationStatus}: {duel.autoValidationReason || 'En attente des deux captures.'}</p>
      </section>
    </div>
  );
}

function OcrCard({ title, score, confidence, players = [], text }) {
  return (
    <div className="ocr-card" role="region" aria-label={`Résultat OCR pour ${title}`}>
      <b className="text-white">{title}</b>
      <span className="text-gray-300">Score OCR: <strong className="text-white">{score || '-'}</strong></span>
      <span className="text-gray-300">Confiance: <strong className={confidence >= 85 ? 'text-cyber-accent' : 'text-cyber-warning'}>{confidence || 0}%</strong></span>
      <small className="text-gray-400">Joueurs détectés: {players.length ? players.join(', ') : '-'}</small>
      {text && <details><summary>Texte détecté</summary><p className="text-gray-300">{text}</p></details>}
    </div>
  );
}

function Leaderboard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api('/leaderboard').then(setData);
  }, []);

  const podium = data?.topEarnings?.slice(0, 3) || [];

  return (
    <div className="stack">
      <header className="page-head">
        <span>
          <p className="eyebrow">Classement mondial</p>
          <h1>Classement</h1>
        </span>
        <p className="muted">Les classements se basent sur les données réelles du compte, sans période simulée.</p>
      </header>
      <section className="panel">
        <h2>Podium du moment</h2>
        <div className="podium">
          {podium.length ? podium.map((player, index) => (
            <div key={player._id || index} className={`podium-card podium-card-${index + 1}`}>
              <span className="podium-rank">#{index + 1}</span>
              <strong>{player.username}</strong>
              <small>{player.country} · {player.rank}</small>
              <b>{money(player.totalEarnings)}</b>
            </div>
          )) : <p className="muted">Aucun podium pour le moment.</p>}
        </div>
      </section>
      <div className="grid two">
        <Board title="Meilleurs gains" rows={data?.topEarnings} value={(u) => money(u.totalEarnings)} />
        <Board title="Plus de victoires" rows={data?.topWins} value={(u) => `${u.wins} victoires`} />
      </div>
      <div className="grid two">
        <Board title="Meilleur taux de victoire" rows={data?.topWinRate} value={(u) => `${Math.round(u.winRateCalc || u.winRate || 0)}%`} />
        <CountryBoard rows={data?.byCountry} />
      </div>
    </div>
  );
}

function Board({ title, rows = [], value }) {
  return (
    <section className="panel" aria-labelledby={`board-${title.replace(/\s/g, '-')}`}>
      <h2 id={`board-${title.replace(/\s/g, '-')}`}>{title}</h2>
      <DataList rows={rows} empty="Aucun classement pour le moment" render={(u, index) => (
        <div className="row">
          <span>#{index + 1} {u.username}<small className="text-gray-300">{u.country} · {u.rank}</small></span>
          <strong className="text-white">{value(u)}</strong>
        </div>
      )} />
    </section>
  );
}

function CountryBoard({ rows = [] }) {
  return (
    <section className="panel" aria-labelledby="country-board-title">
      <h2 id="country-board-title">Répartition par pays</h2>
      <DataList rows={rows} empty="Aucune donnée par pays" render={(country) => (
        <div className="row">
          <span>{country._id || 'Inconnu'}<small className="text-gray-300">{country.players} joueur{country.players > 1 ? 's' : ''}</small></span>
          <strong className="text-white">{money(country.earnings)}</strong>
        </div>
      )} />
    </section>
  );
}

function HistoryView({ refreshTick }) {
  const [transactions, setTransactions] = useState([]);
  const [filter, setFilter] = useState('all');
  const [message, setMessage] = useState('');

  useEffect(() => {
    setMessage('');
    api('/wallet/transactions')
      .then((data) => setTransactions(data.transactions))
      .catch((error) => {
        setTransactions([]);
        setMessage(error.message);
      });
  }, [refreshTick]);

  const filteredTransactions = useMemo(
    () => transactions.filter((transaction) => filter === 'all' || transactionGroup(transaction.type) === filter),
    [transactions, filter]
  );

  const totals = useMemo(() => {
    const groups = transactions.reduce((acc, transaction) => {
      const group = transactionGroup(transaction.type);
      acc[group] = (acc[group] || 0) + 1;
      return acc;
    }, { all: transactions.length, wallet: 0, duel: 0, admin: 0 });
    groups.wallet = transactions.filter((transaction) => transactionGroup(transaction.type) === 'wallet').length;
    groups.duel = transactions.filter((transaction) => transactionGroup(transaction.type) === 'duel').length;
    groups.admin = transactions.filter((transaction) => transactionGroup(transaction.type) === 'admin').length;
    return groups;
  }, [transactions]);

  return (
    <div className="stack">
      <header className="page-head">
        <span>
          <p className="eyebrow">Suivi du portefeuille</p>
          <h1>Historique des transactions</h1>
        </span>
        <p className="muted">Lecture simple des flux du wallet, des duels et des ajustements admin.</p>
      </header>
      <section className="panel">
        <div className="summary-stack">
          <div className="summary-line"><span>Total</span><strong>{totals.all}</strong></div>
          <div className="summary-line"><span>Wallet</span><strong>{totals.wallet}</strong></div>
          <div className="summary-line"><span>Duels</span><strong>{totals.duel}</strong></div>
          <div className="summary-line"><span>Admin</span><strong>{totals.admin}</strong></div>
        </div>
      </section>
      {message && <section className="panel"><p className="muted">{message}</p></section>}
      <section className="panel">
        <div className="transaction-tabs">
          {[
            ['all', `Tout (${totals.all})`],
            ['wallet', `Wallet (${totals.wallet})`],
            ['duel', `Duels (${totals.duel})`],
            ['admin', `Admin (${totals.admin})`]
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={filter === value ? 'active' : ''}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <DataList
          rows={filteredTransactions}
          empty="Aucune transaction"
          render={(transaction) => (
            <div className="row">
              <span>
                {transactionLabel(transaction.type)}
                <small className="text-gray-300">
                  {transaction.description}
                  {transaction.metadata?.reason ? ` · ${transaction.metadata.reason}` : ''}
                  {transaction.createdAt ? ` · ${timeAgo(transaction.createdAt)}` : ''}
                </small>
              </span>
              <strong className="text-white">{money(transaction.amount)}</strong>
              <b className={`status-pill status-pill--${transactionTone(transaction.type)}`}>{transaction.status}</b>
            </div>
          )}
        />
      </section>
    </div>
  );
}

function Admin() {
  const [overview, setOverview] = useState(null);
  const [disputes, setDisputes] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [usernameRequests, setUsernameRequests] = useState([]);
  const [inbox, setInbox] = useState({ items: [], counts: { total: 0, deposits: 0, withdrawals: 0, disputes: 0, usernameRequests: 0 } });
  const [users, setUsers] = useState([]);
  const [duels, setDuels] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [commissions, setCommissions] = useState([]);
  const [depositFilter, setDepositFilter] = useState('pending');
  const [adminNote, setAdminNote] = useState('');
  const [adminMessage, setAdminMessage] = useState('');
  const [balanceAdjustments, setBalanceAdjustments] = useState({});
  const [commissionForm, setCommissionForm] = useState({ name: '', minAmount: '', maxAmount: '', rate: '', type: 'duel', active: true });

  async function loadAdmin() {
    setAdminMessage('');
    const { data, errors } = await loadSections({
      overview: () => api('/admin/overview'),
      inbox: () => api('/admin/inbox'),
      disputes: () => api('/admin/disputes'),
      deposits: () => api(`/admin/deposits?status=${depositFilter}`),
      usernames: () => api('/admin/username-change-requests?status=pending'),
      users: () => api('/admin/users'),
      duels: () => api('/admin/duels'),
      challenges: () => api('/admin/challenges'),
      commissions: () => api('/admin/commissions')
    });
    setOverview(data.overview);
    setInbox(data.inbox || { items: [], counts: { total: 0, deposits: 0, withdrawals: 0, disputes: 0, usernameRequests: 0 } });
    setDisputes(data.disputes?.disputes || []);
    setDeposits(data.deposits?.deposits || []);
    setUsernameRequests(data.usernames?.requests || []);
    setUsers(data.users?.users || []);
    setDuels(data.duels?.duels || []);
    setChallenges(data.challenges?.challenges || []);
    setCommissions(data.commissions?.settings || []);
    if (errors.length) setAdminMessage(errors.join(' · '));
  }
  useEffect(() => { loadAdmin(); }, [depositFilter]);
  async function resolve(id, winnerId) { await api(`/admin/disputes/${id}/resolve`, { method: 'POST', body: { action: 'winner', winnerId } }); setDisputes(disputes.filter((d) => d._id !== id)); }
  async function approveDeposit(id) { await api(`/admin/deposits/${id}/approve`, { method: 'POST', body: { adminNote } }); setAdminNote(''); loadAdmin(); }
  async function rejectDeposit(id) { await api(`/admin/deposits/${id}/reject`, { method: 'POST', body: { adminNote } }); setAdminNote(''); loadAdmin(); }
  async function approveUsername(id) { await api(`/admin/username-change-requests/${id}/approve`, { method: 'POST', body: { adminNote } }); setAdminNote(''); loadAdmin(); }
  async function rejectUsername(id) { await api(`/admin/username-change-requests/${id}/reject`, { method: 'POST', body: { adminNote } }); setAdminNote(''); loadAdmin(); }
  async function approveWithdrawal(id) { await api(`/admin/withdrawals/${id}/approve`, { method: 'POST', body: { adminNote } }); setAdminNote(''); loadAdmin(); }
  async function rejectWithdrawal(id) { await api(`/admin/withdrawals/${id}/reject`, { method: 'POST', body: { adminNote } }); setAdminNote(''); loadAdmin(); }
  async function banUser(id, isBanned) { await api(`/admin/users/${id}/ban`, { method: 'POST', body: { isBanned } }); loadAdmin(); }
  async function adjustUserBalance(id) {
    const payload = balanceAdjustments[id];
    if (!payload?.amount || !payload?.description) return;
    await api(`/admin/users/${id}/adjust-balance`, {
      method: 'POST',
      body: { amount: Number(payload.amount), description: payload.description }
    });
    setBalanceAdjustments((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    loadAdmin();
  }
  async function createCommission() {
    await api('/admin/commissions', {
      method: 'POST',
      body: {
        name: commissionForm.name,
        minAmount: Number(commissionForm.minAmount),
        maxAmount: commissionForm.maxAmount === '' ? null : Number(commissionForm.maxAmount),
        rate: Number(commissionForm.rate),
        type: commissionForm.type,
        active: Boolean(commissionForm.active)
      }
    });
    setCommissionForm({ name: '', minAmount: '', maxAmount: '', rate: '', type: 'duel', active: true });
    loadAdmin();
  }
  return (
    <div className="stack">
      <header className="page-head">
        <span>
          <p className="eyebrow">Console opérateur</p>
          <h1>Tableau de bord Admin</h1>
        </span>
      </header>
      {adminMessage && <section className="panel"><p className="muted">{adminMessage}</p></section>}
      <div className="grid stats">
        <Stat icon={UserRound} label="Utilisateurs" value={overview?.users} />
        <Stat icon={Swords} label="Duels actifs" value={overview?.activeDuels} />
        <Stat icon={Shield} label="Litiges" value={overview?.disputes} />
        <Stat icon={Bell} label="Boîte de réception" value={inbox?.counts?.total || 0} />
        <Stat icon={Banknote} label="Commissions" value={money(overview?.commissionsEarned || 0)} />
        <Stat icon={Wallet} label="Solde total" value={money(overview?.wallets?.total || 0)} />
      </div>
      <section className="panel admin-inbox" aria-labelledby="admin-inbox-title">
        <div className="page-head">
          <span>
            <p className="eyebrow">Actions à traiter</p>
            <h2 id="admin-inbox-title">Boîte de réception admin</h2>
          </span>
          <button className="secondary" onClick={loadAdmin} aria-label="Rafraîchir la boîte de réception">Rafraîchir</button>
        </div>
        <div className="inbox-tabs" aria-label="Résumé boîte de réception">
          <span>Dépôts {inbox?.counts?.deposits || 0}</span>
          <span>Retraits {inbox?.counts?.withdrawals || 0}</span>
          <span>Litiges {inbox?.counts?.disputes || 0}</span>
          <span>Usernames {inbox?.counts?.usernameRequests || 0}</span>
        </div>
        <DataList rows={inbox?.items} empty="Boîte de réception vide" render={(item) => (
          <div className={`inbox-item ${item.priority === 'high' ? 'high' : ''}`}>
            <div>
              <b>{item.title}</b>
              <small>{item.actor?.username || 'Utilisateur'} {item.opponent ? `vs ${item.opponent.username}` : ''} · {item.amount ? money(item.amount) : item.payload?.requestedUsername || ''}</small>
            </div>
            <span className="inbox-badge">{item.type}</span>
            {item.type === 'deposit' && <button onClick={() => approveDeposit(item.id)} className="cyber-button">Approuver</button>}
            {item.type === 'deposit' && <button className="danger" onClick={() => rejectDeposit(item.id)}>Rejeter</button>}
            {item.type === 'withdrawal' && <button onClick={() => api(`/admin/withdrawals/${item.id}/approve`, { method: 'POST', body: { adminNote } }).then(loadAdmin)} className="cyber-button">Valider</button>}
            {item.type === 'withdrawal' && <button className="danger" onClick={() => api(`/admin/withdrawals/${item.id}/reject`, { method: 'POST', body: { adminNote } }).then(loadAdmin)}>Rejeter</button>}
            {item.type === 'dispute' && <button onClick={() => resolve(item.id, item.payload.player1?._id)} className="cyber-button">J1 gagne</button>}
            {item.type === 'dispute' && <button onClick={() => resolve(item.id, item.payload.player2?._id)} className="cyber-button">J2 gagne</button>}
            {item.type === 'username' && <button onClick={() => approveUsername(item.id)} className="cyber-button">Approuver</button>}
            {item.type === 'username' && <button className="danger" onClick={() => rejectUsername(item.id)}>Rejeter</button>}
          </div>
        )} />
      </section>
      <section className="panel" aria-labelledby="username-requests-title">
        <h2 id="username-requests-title">Demandes username eFootball</h2>
        <DataList rows={usernameRequests} empty="Aucune demande username" render={(r) => (
          <div className="row">
            <span>{r.user?.username}<small className="text-gray-300">{r.currentUsername} vers {r.requestedUsername} · {r.reason || 'sans raison'}</small></span>
            <button onClick={() => approveUsername(r._id)} className="cyber-button" aria-label={`Approuver le changement de username pour ${r.user?.username}`}>Approuver</button>
            <button className="danger" onClick={() => rejectUsername(r._id)} aria-label={`Rejeter le changement de username pour ${r.user?.username}`}>Rejeter</button>
          </div>
        )} />
      </section>
      <section className="panel" aria-labelledby="deposits-title">
        <h2 id="deposits-title">Dépôts manuels</h2>
        <div className="filters compact">
          <label htmlFor="deposit-filter" className="sr-only">Filtrer par statut</label>
          <select id="deposit-filter" value={depositFilter} onChange={(e) => setDepositFilter(e.target.value)}>
            <option value="pending">En attente</option>
            <option value="approved">Approuvé</option>
            <option value="rejected">Rejeté</option>
          </select>
          <label htmlFor="admin-note" className="sr-only">Note admin</label>
          <input id="admin-note" value={adminNote} onChange={(e) => setAdminNote(e.target.value)} placeholder="Note admin" />
        </div>
        <DataList rows={deposits} empty="Aucun dépôt" render={(d) => (
          <div className="deposit-row">
            <div className="row">
              <span>{d.user?.username} · {d.method.toUpperCase()}<small className="text-gray-300">{d.senderName} · {d.senderPhone} · {d.transactionReference || 'sans référence'}</small></span>
              <strong className="text-white">{money(d.amount)}</strong>
              <b className={d.status === 'approved' ? 'text-cyber-accent' : d.status === 'rejected' ? 'text-cyber-danger' : 'text-cyber-warning'}>{d.status}</b>
              {d.status === 'pending' && <button onClick={() => approveDeposit(d._id)} className="cyber-button" aria-label={`Approuver le dépôt de ${money(d.amount)} de ${d.user?.username}`}>Approuver</button>}
              {d.status === 'pending' && <button className="danger" onClick={() => rejectDeposit(d._id)} aria-label={`Rejeter le dépôt de ${money(d.amount)} de ${d.user?.username}`}>Rejeter</button>}
            </div>
            <img className="proof-large" src={d.screenshotUrl} alt={`Preuve de dépôt de ${d.user?.username}`} />
          </div>
        )} />
      </section>
      <section className="panel" aria-labelledby="disputes-title">
        <h2 id="disputes-title">Litiges</h2>
        <DataList rows={disputes} empty="Aucun litige" render={(d) => (
          <div className="row">
            <span>{d.player1?.username} vs {d.player2?.username}<small className="text-gray-300">{d.disputeReason} · OCR {d.ocrConfidencePlayer1 || 0}% / {d.ocrConfidencePlayer2 || 0}% · {d.autoValidationStatus}</small></span>
            <button onClick={() => resolve(d._id, d.player1?._id)} className="cyber-button" aria-label={`Attribuer la victoire à ${d.player1?.username} dans le litige`}>J1 gagne</button>
            <button onClick={() => resolve(d._id, d.player2?._id)} className="cyber-button" aria-label={`Attribuer la victoire à ${d.player2?.username} dans le litige`}>J2 gagne</button>
          </div>
        )} />
      </section>
      <section className="panel" aria-labelledby="users-title">
        <div className="page-head">
          <span>
            <p className="eyebrow">Pilotage comptes</p>
            <h2 id="users-title">Utilisateurs</h2>
          </span>
          <small className="muted">{users.length} comptes chargés</small>
        </div>
        <DataList rows={users} empty="Aucun utilisateur" render={(user) => (
          <div className="row">
            <span>
              {user.username}
              <small className="text-gray-300">{user.email} · {user.country || 'Pays non renseigné'} · {user.isBanned ? 'banni' : 'actif'}</small>
            </span>
            <div className="inline">
              <button className={user.isBanned ? 'secondary' : 'danger'} onClick={() => banUser(user._id, !user.isBanned)}>
                {user.isBanned ? 'Débannir' : 'Bannir'}
              </button>
            </div>
          </div>
        )} />
      </section>
      <section className="panel" aria-labelledby="balances-title">
        <div className="page-head">
          <span>
            <p className="eyebrow">Opérations financières</p>
            <h2 id="balances-title">Ajuster un solde</h2>
          </span>
          <small className="muted">Crédits ou débits manuels tracés en transaction admin.</small>
        </div>
        <DataList rows={users.slice(0, 20)} empty="Aucun utilisateur" render={(user) => {
          const current = balanceAdjustments[user._id] || { amount: '', description: '' };
          return (
            <div className="row">
              <span>
                {user.username}
                <small className="text-gray-300">{user.email}</small>
              </span>
              <input
                style={{ maxWidth: '120px' }}
                type="number"
                value={current.amount}
                onChange={(e) => setBalanceAdjustments((prev) => ({ ...prev, [user._id]: { ...current, amount: e.target.value } }))}
                placeholder="Montant"
              />
              <input
                style={{ maxWidth: '220px' }}
                value={current.description}
                onChange={(e) => setBalanceAdjustments((prev) => ({ ...prev, [user._id]: { ...current, description: e.target.value } }))}
                placeholder="Raison"
              />
              <button className="cyber-button" onClick={() => adjustUserBalance(user._id)}>Appliquer</button>
            </div>
          );
        }} />
      </section>
      <section className="panel" aria-labelledby="duels-title">
        <h2 id="duels-title">Duels</h2>
        <DataList rows={duels} empty="Aucun duel" render={(duel) => (
          <div className="row">
            <span>{duel.player1?.username} vs {duel.player2?.username}<small className="text-gray-300">{duel.status} · {money(duel.potTotal)} · {duel.matchType || 'duel'}</small></span>
            <b className="status-pill status-pill--neutral">{duel.winner ? 'terminé' : duel.status}</b>
          </div>
        )} />
      </section>
      <section className="panel" aria-labelledby="challenges-title">
        <h2 id="challenges-title">Challenges</h2>
        <DataList rows={challenges} empty="Aucun challenge" render={(challenge) => (
          <div className="row">
            <span>{challenge.challenger?.username} → {challenge.challenged?.username}<small className="text-gray-300">{challenge.status} · {money(challenge.amount)} · {challenge.matchType || 'duel'}</small></span>
            <strong className="text-white">{timeAgo(challenge.createdAt)}</strong>
          </div>
        )} />
      </section>
      <section className="panel" aria-labelledby="commissions-title">
        <div className="page-head">
          <span>
            <p className="eyebrow">Paramètres financiers</p>
            <h2 id="commissions-title">Commissions</h2>
          </span>
          <small className="muted">Les tarifs actifs sont utilisés pour les prochains duels.</small>
        </div>
        <div className="grid two">
          <section className="panel form" aria-labelledby="commission-form-title">
            <h3 id="commission-form-title">Nouvelle commission</h3>
            <input placeholder="Nom" value={commissionForm.name} onChange={(e) => setCommissionForm({ ...commissionForm, name: e.target.value })} />
            <input placeholder="Montant minimum" type="number" value={commissionForm.minAmount} onChange={(e) => setCommissionForm({ ...commissionForm, minAmount: e.target.value })} />
            <input placeholder="Montant maximum" type="number" value={commissionForm.maxAmount} onChange={(e) => setCommissionForm({ ...commissionForm, maxAmount: e.target.value })} />
            <input placeholder="Taux" type="number" step="0.01" value={commissionForm.rate} onChange={(e) => setCommissionForm({ ...commissionForm, rate: e.target.value })} />
            <select value={commissionForm.type} onChange={(e) => setCommissionForm({ ...commissionForm, type: e.target.value })}>
              <option value="duel">Duel</option>
              <option value="tournament">Tournament</option>
            </select>
            <label className="inline" style={{ alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={commissionForm.active}
                onChange={(e) => setCommissionForm({ ...commissionForm, active: e.target.checked })}
                style={{ width: 'auto', minHeight: 'auto' }}
              />
              Actif
            </label>
            <button type="button" className="cyber-button" onClick={createCommission}>Créer la commission</button>
          </section>
          <section className="panel">
            <h3>Tarifs existants</h3>
            <DataList rows={commissions} empty="Aucune commission" render={(setting) => (
              <div className="row">
                <span>
                  {setting.name}
                  <small className="text-gray-300">{money(setting.minAmount)} - {setting.maxAmount === null ? '∞' : money(setting.maxAmount)} · {setting.type}</small>
                </span>
                <strong className="text-white">{Math.round((setting.rate || 0) * 100)}%</strong>
              </div>
            )} />
          </section>
        </div>
      </section>
    </div>
  );
}

function DataList({ rows = [], render, empty }) {
  if (!rows?.length) {
    return (
      <div className="empty-state">
        <strong>{empty}</strong>
        <small className="text-gray-300">Les éléments apparaîtront ici dès qu'ils seront disponibles.</small>
      </div>
    );
  }
  return <div className="list">{rows.map((row, index) => <React.Fragment key={row._id || index}>{render(row, index)}</React.Fragment>)}</div>;
}

createRoot(document.getElementById('root')).render(<App />);
