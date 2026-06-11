import React, { useEffect, useState } from 'react';
import { Crown, Medal } from 'lucide-react';
import { api } from '../api.js';
import { labelForPlayerRank, moneyOrDash, toDisplayName } from '../appShared.js';

export function LeaderboardView({ user, refreshTick }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('earnings');

  useEffect(() => {
    api('/leaderboard').then(setData).catch(() => { });
  }, [refreshTick]);

  const rows = tab === 'earnings' ? data?.topEarnings || [] : tab === 'wins' ? data?.topWins || [] : data?.topTrust || [];
  const podium = rows.slice(0, 3);
  const userRank = rows.findIndex((player) => String(player._id) === String(user._id));

  return (
    <section className="page-stack">
      <div className="panel">
        <div className="panel-head"><div><p className="eyebrow">Classement</p><h2>Top joueurs</h2></div></div>
        <div className="tab-row">
          <button type="button" className={tab === 'earnings' ? 'tab is-active' : 'tab'} onClick={() => setTab('earnings')}>Gains</button>
          <button type="button" className={tab === 'wins' ? 'tab is-active' : 'tab'} onClick={() => setTab('wins')}>Victoires</button>
          <button type="button" className={tab === 'trust' ? 'tab is-active' : 'tab'} onClick={() => setTab('trust')}>Confiance</button>
        </div>
        <p className="muted">Ton rang actuel : {userRank >= 0 ? `#${userRank + 1}` : 'hors du top 20'}</p>
      </div>

      <div className="podium-grid">
        {podium.map((player, index) => (
          <article key={player._id} className={`podium-card podium-card--${index + 1}`}>
            <span className="podium-rank">{index === 0 ? <Crown size={16} aria-hidden="true" /> : <Medal size={16} aria-hidden="true" />}Rang {index + 1}</span>
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
                <small>{player.efootballUsername || player.username} · {player.winRate ?? 0} % de victoires</small>
              </div>
              <div className="row-meta">
                <strong>{moneyOrDash(player.totalEarnings)}</strong>
                <span className="pill pill--neutral">{labelForPlayerRank(player.rank)}</span>
              </div>
            </article>
          ))}
          {!rows.length && <div className="empty-card">Aucune donnée de classement.</div>}
        </div>
      </div>
    </section>
  );
}
