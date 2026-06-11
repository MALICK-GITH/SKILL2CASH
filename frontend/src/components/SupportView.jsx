import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { api } from '../api.js';
import { labelForStatus, timeAgo, toneClass } from '../appShared.js';

const CATEGORY_OPTIONS = [
  { value: 'deposit', label: 'Dépôt' },
  { value: 'withdrawal', label: 'Retrait' },
  { value: 'dispute', label: 'Litige' },
  { value: 'username_change', label: 'Changement pseudo' },
  { value: 'technical', label: 'Technique' },
  { value: 'other', label: 'Autre' }
];

function labelForCategory(category) {
  return CATEGORY_OPTIONS.find((option) => option.value === category)?.label || category || 'Autre';
}

function priorityLabel(priority = '') {
  const map = {
    low: 'Basse',
    normal: 'Normale',
    high: 'Haute',
    urgent: 'Urgente'
  };
  return map[priority] || priority || 'Normale';
}

export function SupportView({ user, refreshTick }) {
  const isAdmin = user?.role === 'admin';
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [replyingId, setReplyingId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState({
    category: 'deposit',
    subject: '',
    message: ''
  });
  const [replyForms, setReplyForms] = useState({});

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    api('/support-tickets')
      .then((data) => {
        if (!active) return;
        setTickets(data.tickets || []);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || 'Impossible de charger les tickets.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [refreshTick]);

  const filteredTickets = useMemo(() => (
    filter === 'all' ? tickets : tickets.filter((ticket) => ticket.status === filter)
  ), [filter, tickets]);

  const stats = useMemo(() => ({
    total: tickets.length,
    open: tickets.filter((ticket) => ticket.status === 'open').length,
    inProgress: tickets.filter((ticket) => ticket.status === 'in_progress').length,
    resolved: tickets.filter((ticket) => ticket.status === 'resolved' || ticket.status === 'closed').length
  }), [tickets]);

  function getReplyForm(ticketId) {
    return replyForms[ticketId] || {
      adminResponse: '',
      status: 'resolved',
      priority: 'normal'
    };
  }

  function updateReplyForm(ticketId, updates) {
    setReplyForms((current) => ({
      ...current,
      [ticketId]: {
        ...getReplyForm(ticketId),
        ...updates
      }
    }));
  }

  async function submitTicket(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const data = await api('/support-tickets', { method: 'POST', body: form });
      setTickets((current) => [data.ticket, ...current]);
      setForm({ category: 'deposit', subject: '', message: '' });
      setSuccess('Ticket envoyé au support.');
    } catch (err) {
      setError(err.message || 'Impossible d’envoyer le ticket.');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReply(ticketId) {
    setReplyingId(ticketId);
    setError('');
    setSuccess('');
    try {
      const data = await api(`/support-tickets/${ticketId}`, { method: 'PATCH', body: getReplyForm(ticketId) });
      setTickets((current) => current.map((ticket) => (
        String(ticket._id) === String(ticketId) ? data.ticket : ticket
      )));
      setReplyForms((current) => ({
        ...current,
        [ticketId]: {
          adminResponse: '',
          status: 'resolved',
          priority: 'normal'
        }
      }));
      setSuccess('Réponse support enregistrée.');
    } catch (err) {
      setError(err.message || 'Impossible de répondre au ticket.');
    } finally {
      setReplyingId('');
    }
  }

  return (
    <section className="page-stack">
      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Support</p>
            <h2>{isAdmin ? 'Tickets utilisateurs' : 'Contacter le support'}</h2>
          </div>
        </div>
        <p className="muted">
          {isAdmin
            ? 'Traite les litiges, soucis de dépôt, retrait ou changement de pseudo.'
            : 'Ouvre un ticket simple pour les litiges, erreurs de dépôt, retraits ou demandes de changement de pseudo.'}
        </p>
      </div>

      <div className="support-stats">
        <article className="support-stat-card"><span>Total</span><strong>{stats.total}</strong></article>
        <article className="support-stat-card"><span>Ouverts</span><strong>{stats.open}</strong></article>
        <article className="support-stat-card"><span>En cours</span><strong>{stats.inProgress}</strong></article>
        <article className="support-stat-card"><span>Résolus</span><strong>{stats.resolved}</strong></article>
      </div>

      {!isAdmin && (
        <form className="panel auth-form support-form" onSubmit={submitTicket}>
          <label>
            Catégorie
            <select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}>
              {CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            Sujet
            <input value={form.subject} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} placeholder="Ex: Dépôt non validé" required />
          </label>
          <label>
            Message
            <textarea value={form.message} onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))} rows={5} placeholder="Explique le problème avec les détails utiles." required />
          </label>
          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
            Envoyer le ticket
          </button>
        </form>
      )}

      <div className="panel">
        <div className="tab-row support-filter-row">
          {['all', 'open', 'in_progress', 'waiting_user', 'resolved', 'closed'].map((status) => (
            <button key={status} type="button" className={filter === status ? 'tab is-active' : 'tab'} onClick={() => setFilter(status)}>
              {status === 'all' ? 'Tous' : labelForStatus(status)}
            </button>
          ))}
        </div>
        {error && <p className="error">{error}</p>}
        {success && <p className="success">{success}</p>}
        {loading ? (
          <div className="empty-card">Chargement des tickets…</div>
        ) : (
          <div className="list-stack support-ticket-list">
            {filteredTickets.map((ticket) => {
              const replyForm = getReplyForm(ticket._id);
              return (
                <article key={ticket._id} className="panel support-ticket-card">
                  <div className="panel-head support-ticket-head">
                    <div>
                      <strong>{ticket.subject}</strong>
                      <small>{labelForCategory(ticket.category)} · {timeAgo(ticket.createdAt)}</small>
                    </div>
                    <div className="support-ticket-badges">
                      <span className={toneClass(ticket.status)}>{labelForStatus(ticket.status)}</span>
                      <span className="pill pill--neutral">{priorityLabel(ticket.priority)}</span>
                    </div>
                  </div>

                  <p className="muted">{ticket.message}</p>

                  {isAdmin && ticket.user && (
                    <div className="support-ticket-meta">
                      <span><strong>Joueur:</strong> {ticket.user.efootballUsername || ticket.user.username || ticket.user.email}</span>
                      <span><strong>Assigné:</strong> {ticket.assignedTo?.username || 'Non assigné'}</span>
                    </div>
                  )}

                  {ticket.adminResponse && (
                    <div className="panel support-reply-box">
                      <strong>Réponse support</strong>
                      <p className="muted">{ticket.adminResponse}</p>
                    </div>
                  )}

                  {isAdmin && (
                    <div className="auth-form support-admin-form">
                      <label>
                        Réponse admin
                        <textarea
                          value={replyForm.adminResponse}
                          onChange={(event) => updateReplyForm(ticket._id, { adminResponse: event.target.value })}
                          rows={3}
                          placeholder="Réponse au joueur"
                        />
                      </label>
                      <div className="support-admin-grid">
                        <label>
                          Statut
                          <select value={replyForm.status} onChange={(event) => updateReplyForm(ticket._id, { status: event.target.value })}>
                            <option value="in_progress">En cours</option>
                            <option value="waiting_user">Attente joueur</option>
                            <option value="resolved">Résolu</option>
                            <option value="closed">Clos</option>
                          </select>
                        </label>
                        <label>
                          Priorité
                          <select value={replyForm.priority} onChange={(event) => updateReplyForm(ticket._id, { priority: event.target.value })}>
                            <option value="low">Basse</option>
                            <option value="normal">Normale</option>
                            <option value="high">Haute</option>
                            <option value="urgent">Urgente</option>
                          </select>
                        </label>
                      </div>
                      <button type="button" className="primary-button" disabled={replyingId === ticket._id} onClick={() => { void submitReply(ticket._id); }}>
                        {replyingId === ticket._id ? <Loader2 size={16} className="spin" aria-hidden="true" /> : null}
                        Répondre
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
            {!filteredTickets.length && <div className="empty-card">Aucun ticket pour ce filtre.</div>}
          </div>
        )}
      </div>
    </section>
  );
}
