import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { labelForStatus, labelForTransaction, moneyOrDash, toDisplayName, toneClass } from '../appShared.js';

export function HistoryView({ refreshTick }) {
  const [tab, setTab] = useState('matches');
  const [duels, setDuels] = useState([]);
  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    Promise.all([api('/duels'), api('/wallet/transactions?limit=20')])
      .then(([duelsData, txData]) => {
        setDuels(duelsData.duels || []);
        setTransactions(txData.transactions || []);
      })
      .catch(() => { });
  }, [refreshTick]);

  function duelScore(duel) {
    if (duel.resultPlayer1?.score) return duel.resultPlayer1.score;
    if (duel.resultPlayer2?.score) return duel.resultPlayer2.score;
    return duel.status;
  }

  return (
    <section className="page-stack">
      <div className="panel">
        <div className="panel-head"><div><p className="eyebrow">Historique</p><h2>Matchs et cash</h2></div></div>
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
                  <small>{transaction.description || 'Mouvement'}</small>
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
