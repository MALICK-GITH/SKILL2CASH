import React, { useEffect, useState } from 'react';
import { Banknote, Gamepad2, History, Trophy } from 'lucide-react';
import { api } from '../api.js';
import { moneyOrDash, toDisplayName } from '../appShared.js';

export function DashboardView({ user, refreshTick, onGoPlay, onGoDeposit, onGoLeaderboard, onGoHistory }) {
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let timeoutId = null;

    if (!loadedOnce) setLoading(true);
    setError('');

    timeoutId = window.setTimeout(() => {
      if (active) {
        setLoading(false);
        setLoadedOnce(true);
        if (!wallet) setError('Le serveur met trop de temps à répondre. Rafraîchissez la page.');
      }
    }, 35000);

    api('/wallet')
      .then((data) => {
        if (!active) return;
        setWallet(data.wallet);
        setLoadedOnce(true);
        setError('');
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || 'Erreur de connexion au serveur');
      })
      .finally(() => {
        if (active) {
          window.clearTimeout(timeoutId);
          setLoading(false);
        }
      });

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [refreshTick, loadedOnce, wallet]);

  return (
    <section className="page-stack">
      <div className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">Tableau de bord</p>
          <h2>Solde, actions et raccourcis</h2>
          <p className="muted">Tout ce qui compte tient dans un seul écran, sans surcharge visuelle.</p>
        </div>
        <button type="button" className="primary-button hero-button" onClick={onGoPlay}>
          <Gamepad2 size={18} aria-hidden="true" />
          Jouer maintenant
        </button>
      </div>

      <div className="metric-grid">
        <article className="metric-card"><span>Solde disponible</span><strong>{loading && !loadedOnce ? '...' : moneyOrDash(wallet?.balanceAvailable)}</strong></article>
        <article className="metric-card"><span>Solde bloqué</span><strong>{loading && !loadedOnce ? '...' : moneyOrDash(wallet?.balanceLocked)}</strong></article>
        <article className="metric-card metric-card--accent"><span>Utilisateur</span><strong>{toDisplayName(user)}</strong></article>
      </div>

      {error && <div className="panel"><p className="error">{error}</p></div>}

      <div className="shortcut-grid">
        <button type="button" className="shortcut-card" onClick={onGoDeposit}><Banknote size={18} aria-hidden="true" /><span>Déposer</span><small>Dépôt rapide</small></button>
        <button type="button" className="shortcut-card" onClick={onGoLeaderboard}><Trophy size={18} aria-hidden="true" /><span>Classement</span><small>Top joueurs</small></button>
        <button type="button" className="shortcut-card" onClick={onGoHistory}><History size={18} aria-hidden="true" /><span>Historique</span><small>Matchs et cash</small></button>
      </div>
    </section>
  );
}
