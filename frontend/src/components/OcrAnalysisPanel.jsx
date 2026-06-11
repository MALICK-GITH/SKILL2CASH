import { useEffect, useState } from 'react';
import { Scan, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../api.js';

export function OcrAnalysisPanel({ duel, player1, player2, resultPlayer1, resultPlayer2 }) {
  const [ocrStatus, setOcrStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    let interval;

    async function fetchOcrStatus() {
      try {
        const data = await api(`/duels/${duel._id}/ocr-status`);
        if (!active) return;
        setOcrStatus(data.ocrStatus);
        setLoading(false);
        
        // Continuer le polling si analyse en cours
        if (data.ocrStatus?.analyzing) {
          interval = setTimeout(fetchOcrStatus, 2000);
        }
      } catch (err) {
        if (!active) return;
        setError(err.message);
        setLoading(false);
      }
    }

    fetchOcrStatus();

    return () => {
      active = false;
      if (interval) clearTimeout(interval);
    };
  }, [duel._id]);

  if (loading) {
    return (
      <div className="panel panel--accent">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Analyse OCR</p>
            <h2>Analyse en cours...</h2>
          </div>
          <Loader2 size={20} className="spin" />
        </div>
        <div style={{ padding: '20px 0', textAlign: 'center' }}>
          <div style={{
            width: 40,
            height: 40,
            border: '3px solid var(--accent-2)',
            borderTopColor: 'var(--accent)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 12px'
          }} />
          <p className="muted">Initialisation de l'analyse...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Analyse OCR</p>
            <h2>Erreur d'analyse</h2>
          </div>
        </div>
        <p className="error">{error}</p>
      </div>
    );
  }

  const { analyzing, finished, analysis, player1: p1Data, player2: p2Data } = ocrStatus || {};
  const progress = analysis?.progress || 0;

  return (
    <div className={`panel ${analyzing ? 'panel--accent' : ''}`}>
      <div className="panel-head">
        <div>
          <p className="eyebrow">Analyse OCR</p>
          <h2>
            {analyzing ? 'Analyse en cours...' : finished ? 'Analyse terminée' : 'En attente'}
          </h2>
        </div>
        {analyzing && <Scan size={20} className="pulse" />}
        {finished && <CheckCircle size={20} style={{ color: 'var(--success)' }} />}
      </div>

      {/* Barre de progression */}
      <div style={{ marginBottom: 16 }}>
        <div style={{
          height: 8,
          background: 'var(--bg-1)',
          borderRadius: 4,
          overflow: 'hidden'
        }}>
          <div style={{
            height: '100%',
            width: `${progress}%`,
            background: analyzing ? 'var(--accent)' : 'var(--success)',
            borderRadius: 4,
            transition: 'width 0.3s ease'
          }} />
        </div>
        <p style={{ marginTop: 8, fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>
          {analysis?.message || 'Analyse en cours...'} ({progress}%)
        </p>
      </div>

      {/* Détails des captures analysées */}
      <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
        {p1Data && (
          <div style={{
            padding: 12,
            background: 'var(--bg-1)',
            borderRadius: 8,
            border: '1px solid var(--accent-2)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: 14 }}>{player1?.efootballUsername || player1?.username || 'Joueur 1'}</strong>
              {p1Data.ocrDetected && (
                <span style={{ 
                  fontSize: 12, 
                  color: 'var(--success)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4
                }}>
                  <CheckCircle size={12} />
                  Score détecté
                </span>
              )}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 16, fontSize: 13 }}>
              <span>Score soumis: <strong>{p1Data.score}</strong></span>
              {p1Data.ocrDetected && (
                <span style={{ color: 'var(--muted)' }}>
                  Confiance OCR: {p1Data.ocrDetected.confidence}%
                </span>
              )}
            </div>
          </div>
        )}

        {p2Data && (
          <div style={{
            padding: 12,
            background: 'var(--bg-1)',
            borderRadius: 8,
            border: '1px solid var(--accent-2)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: 14 }}>{player2?.efootballUsername || player2?.username || 'Joueur 2'}</strong>
              {p2Data.ocrDetected && (
                <span style={{ 
                  fontSize: 12, 
                  color: 'var(--success)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4
                }}>
                  <CheckCircle size={12} />
                  Score détecté
                </span>
              )}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 16, fontSize: 13 }}>
              <span>Score soumis: <strong>{p2Data.score}</strong></span>
              {p2Data.ocrDetected && (
                <span style={{ color: 'var(--muted)' }}>
                  Confiance OCR: {p2Data.ocrDetected.confidence}%
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Statut final */}
      {finished && (
        <div style={{
          padding: 12,
          background: analysis?.result === 'validated' ? 'var(--success-bg, #e8f5e9)' : 'var(--warning-bg, #fff3e0)',
          borderRadius: 8,
          border: `1px solid ${analysis?.result === 'validated' ? 'var(--success)' : 'var(--warning)'}`,
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          {analysis?.result === 'validated' ? (
            <>
              <CheckCircle size={18} style={{ color: 'var(--success)' }} />
              <span style={{ color: 'var(--success)', fontWeight: 500 }}>
                {analysis?.message || 'Résultat validé automatiquement'}
              </span>
            </>
          ) : (
            <>
              <AlertCircle size={18} style={{ color: 'var(--warning)' }} />
              <span style={{ color: 'var(--warning)', fontWeight: 500 }}>
                {analysis?.message || 'Vérification manuelle requise'}
              </span>
            </>
          )}
        </div>
      )}

      {/* Message d'attente */}
      {!finished && !analyzing && (
        <p className="muted" style={{ textAlign: 'center' }}>
          En attente des preuves des deux joueurs pour démarrer l'analyse OCR...
        </p>
      )}
    </div>
  );
}
