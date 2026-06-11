import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { Send, MessageSquare, Bell, Wallet, Trophy, Unlink, Copy, Check, AlertCircle } from 'lucide-react';

export function TelegramSettings() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  // Charger le statut Telegram
  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const response = await api('/telegram/status');
      setStatus(response);
      setError(null);
    } catch (err) {
      setError('Erreur lors du chargement du statut Telegram');
    } finally {
      setLoading(false);
    }
  };

  // Générer un code de liaison
  const generateLinkCode = async () => {
    try {
      setGenerating(true);
      const response = await api('/telegram/link-code', { method: 'POST' });
      setStatus(prev => ({ ...prev, linkCode: response.code }));
      setError(null);
    } catch (err) {
      setError('Erreur lors de la génération du code');
    } finally {
      setGenerating(false);
    }
  };

  // Déconnecter Telegram
  const unlinkTelegram = async () => {
    if (!confirm('Êtes-vous sûr de vouloir déconnecter Telegram ? Vous ne recevrez plus de notifications.')) {
      return;
    }
    try {
      setLoading(true);
      await api('/telegram/unlink', { method: 'POST' });
      await loadStatus();
      setError(null);
    } catch (err) {
      setError('Erreur lors de la déconnexion');
    } finally {
      setLoading(false);
    }
  };

  // Mettre à jour les préférences
  const updatePreference = async (key, value) => {
    try {
      await api('/telegram/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ [key]: value })
      });
      setStatus(prev => ({
        ...prev,
        preferences: { ...prev.preferences, [key]: value }
      }));
    } catch (err) {
      console.error('Erreur préférence:', err);
    }
  };

  // Copier le code
  const copyCode = () => {
    if (status?.linkCode) {
      navigator.clipboard.writeText(status.linkCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Notifications</p>
            <h2>Telegram</h2>
          </div>
        </div>
        <div className="empty-card">
          <div className="spin" style={{ width: 24, height: 24, border: '3px solid var(--line)', borderTopColor: 'var(--accent)', borderRadius: '50%' }} />
          <p>Chargement...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Notifications</p>
          <h2>Telegram</h2>
        </div>
        {status?.isLinked && (
          <button
            type="button"
            className="ghost-button"
            onClick={unlinkTelegram}
            disabled={loading}
          >
            <Unlink size={16} />
            Déconnecter
          </button>
        )}
      </div>

      {error && (
        <div className="warning-card" style={{ marginTop: 0 }}>
          <AlertCircle size={18} />
          <p>{error}</p>
        </div>
      )}

      {!status?.isLinked ? (
        <div className="instructions-card" style={{ background: 'rgba(36, 87, 255, 0.08)', borderColor: 'rgba(36, 87, 255, 0.25)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ 
              width: 48, 
              height: 48, 
              borderRadius: 12, 
              background: 'linear-gradient(135deg, #24a2ff, #2488ff)',
              display: 'grid',
              placeItems: 'center',
              color: '#fff'
            }}>
              <Send size={24} />
            </div>
            <div>
              <strong style={{ color: '#60a5fa' }}>Connecte Telegram</strong>
              <p style={{ color: 'var(--muted)', marginTop: 4, fontSize: 14 }}>
                Reçois des notifications instantanées sur ton téléphone
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
            {!status?.linkCode ? (
              <button
                type="button"
                className="primary-button"
                onClick={generateLinkCode}
                disabled={generating}
              >
                {generating ? (
                  <>
                    <div className="spin" style={{ width: 16, height: 16, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%' }} />
                    Génération...
                  </>
                ) : (
                  <>
                    <Send size={16} />
                    Obtenir un code de liaison
                  </>
                )}
              </button>
            ) : (
              <div style={{ 
                padding: 16, 
                background: 'rgba(15, 23, 42, 0.8)', 
                borderRadius: 12,
                border: '1px dashed rgba(36, 87, 255, 0.4)',
                display: 'grid',
                gap: 12
              }}>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 8 }}>Ton code de liaison</p>
                  <div style={{ 
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 12
                  }}>
                    <code style={{ 
                      fontSize: 28, 
                      fontWeight: 700, 
                      letterSpacing: 4,
                      color: '#60a5fa',
                      fontFamily: 'ui-monospace, monospace'
                    }}>
                      {status.linkCode}
                    </code>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={copyCode}
                      style={{ minHeight: 36, padding: '0 12px' }}
                    >
                      {copied ? <Check size={16} color="#22c55e" /> : <Copy size={16} />}
                    </button>
                  </div>
                </div>

                <div style={{ 
                  padding: 12, 
                  background: 'rgba(120, 53, 15, 0.3)', 
                  borderRadius: 8,
                  fontSize: 13,
                  color: '#fbbf24'
                }}>
                  <strong>Comment connecter :</strong>
                  <ol style={{ margin: '8px 0 0 16px', lineHeight: 1.6, color: '#fde68a' }}>
                    <li>Ouvre Telegram et cherche <strong>@Skill2CashBot</strong></li>
                    <li>Envoie la commande : <code>/link {status.linkCode}</code></li>
                    <li>C'est fait ! Le bot confirmera la connexion</li>
                  </ol>
                </div>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setStatus(prev => ({ ...prev, linkCode: null }))}
                >
                  Générer un nouveau code
                </button>
              </div>
            )}
          </div>

          <div style={{ 
            display: 'grid', 
            gap: 8, 
            marginTop: 12,
            padding: 12,
            background: 'rgba(16, 185, 129, 0.08)',
            borderRadius: 10,
            fontSize: 13
          }}>
            <p style={{ color: '#4ade80', fontWeight: 600 }}>Tu recevras des alertes pour :</p>
            <div style={{ display: 'grid', gap: 6, color: 'var(--muted)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <MessageSquare size={14} />
                <span>Nouveaux défis reçus</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Trophy size={14} />
                <span>Résultats des duels</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Wallet size={14} />
                <span>Transactions wallet</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Bell size={14} />
                <span>Rappels de duels en attente</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Statut connecté */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 12,
            padding: 16,
            background: 'rgba(34, 197, 94, 0.1)',
            borderRadius: 12,
            border: '1px solid rgba(34, 197, 94, 0.3)'
          }}>
            <div style={{ 
              width: 40, 
              height: 40, 
              borderRadius: '50%', 
              background: '#22c55e',
              display: 'grid',
              placeItems: 'center',
              color: '#fff'
            }}>
              <Send size={20} />
            </div>
            <div style={{ flex: 1 }}>
              <strong style={{ color: '#4ade80' }}>Connecté à Telegram</strong>
              <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>
                @{status.telegramUsername || status.telegramId}
              </p>
            </div>
            <div style={{ 
              width: 12, 
              height: 12, 
              borderRadius: '50%', 
              background: '#22c55e',
              boxShadow: '0 0 8px #22c55e'
            }} />
          </div>

          {/* Préférences */}
          <div style={{ display: 'grid', gap: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Préférences de notification</h3>
            
            {[
              { key: 'challenges', label: 'Défis reçus', icon: MessageSquare, desc: 'Quand quelqu\'un te défie' },
              { key: 'matches', label: 'Duels', icon: Trophy, desc: 'Rappels et mises à jour' },
              { key: 'results', label: 'Résultats', icon: Trophy, desc: 'Victoires et défaites' },
              { key: 'wallet', label: 'Wallet', icon: Wallet, desc: 'Gains et pertes' }
            ].map(({ key, label, icon: Icon, desc }) => (
              <label key={key} style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 12,
                padding: 12,
                background: 'rgba(15, 23, 42, 0.5)',
                borderRadius: 10,
                cursor: 'pointer'
              }}>
                <div style={{ 
                  width: 36, 
                  height: 36, 
                  borderRadius: 8, 
                  background: 'rgba(16, 185, 129, 0.1)',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'var(--accent)'
                }}>
                  <Icon size={18} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, color: 'var(--text)' }}>{label}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{desc}</div>
                </div>
                <input
                  type="checkbox"
                  checked={status.preferences?.[key] !== false}
                  onChange={(e) => updatePreference(key, e.target.checked)}
                  style={{ 
                    width: 20, 
                    height: 20, 
                    accentColor: 'var(--accent)',
                    cursor: 'pointer'
                  }}
                />
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
