import { useEffect, useState } from 'react';
import { api } from '../api.js';

export function TelegramMiniAppLink() {
  const [status, setStatus] = useState({ state: 'loading', message: 'Vérification...' });
  const [linkCode, setLinkCode] = useState('');
  const [mode, setMode] = useState('auto'); // 'auto' | 'manual' | 'error'

  // Détection de l'environnement Telegram
  useEffect(() => {
    const isTelegramWebView = /Telegram/i.test(navigator.userAgent);
    const hasTelegramSDK = !!window.Telegram?.WebApp;
    const initData = window.Telegram?.WebApp?.initData;

    console.log('[TelegramMiniApp] Detection:', { isTelegramWebView, hasTelegramSDK, hasInitData: !!initData });

    // Si on a le SDK avec initData, mode automatique
    if (hasTelegramSDK && initData) {
      setMode('auto');
      autoLink(initData);
    }
    // Si on est dans Telegram mais sans SDK (domaine non autorisé), proposer mode manuel
    else if (isTelegramWebView) {
      setMode('manual');
      setStatus({
        state: 'idle',
        message: 'Mode liaison manuel. Entre ton code de connexion SKILL2CASH.'
      });
    }
    // Sinon, erreur
    else {
      setMode('error');
      setStatus({
        state: 'error',
        message: 'Cette page doit être ouverte depuis Telegram.'
      });
    }
  }, []);

  // Liaison automatique avec initData + connexion/inscription auto
  async function autoLink(initData) {
    try {
      setStatus({ state: 'loading', message: 'Connexion automatique...' });

      // Initialiser l'app Telegram
      const webApp = window.Telegram.WebApp;
      if (webApp.ready) webApp.ready();
      if (webApp.expand) webApp.expand();

      // === NOUVEAU: Vérification + Création compte auto + Connexion ===
      const response = await api('/telegram/verify', {
        method: 'POST',
        body: { initData }
      });

      if (response.success && response.token) {
        // Stocker le token JWT pour connexion auto
        localStorage.setItem('token', response.token);
        localStorage.setItem('user', JSON.stringify(response.user));

        // Message différent selon nouveau ou existant
        const message = response.isNew
          ? `🎉 Bienvenue ${response.user.username} ! Compte créé et connecté !`
          : `✅ Bon retour ${response.user.username} ! Connecté !`;

        setStatus({ state: 'success', message });

        // Haptic feedback succès
        if (webApp.HapticFeedback) {
          webApp.HapticFeedback.notificationOccurred('success');
        }

        // Redirection après 2 secondes (optionnel)
        setTimeout(() => {
          if (webApp.close) {
            webApp.close(); // Ferme Mini App si succès
          }
        }, 2000);
      } else {
        throw new Error('Réponse invalide du serveur');
      }

    } catch (error) {
      console.error('[TelegramMiniApp] Auto-link error:', error);
      const statusCode = Number(error?.statusCode || 0);

      if (statusCode === 401) {
        // Non authentifié, passer en mode manuel
        setMode('manual');
        setStatus({
          state: 'needs_auth',
          message: 'Connecte-toi à ton compte SKILL2CASH pour finaliser la liaison.'
        });
      } else {
        setMode('error');
        setStatus({ state: 'error', message: error?.message || 'Erreur de connexion.' });
      }
    }
  }

  // Liaison manuelle avec code
  async function manualLink(e) {
    e.preventDefault();
    if (!linkCode.trim()) return;

    try {
      setStatus({ state: 'loading', message: 'Connexion en cours...' });

      // Essayer de récupérer l'ID Telegram si disponible
      const webApp = window.Telegram?.WebApp;
      let telegramData = null;
      if (webApp?.initDataUnsafe?.user) {
        const user = webApp.initDataUnsafe.user;
        telegramData = {
          id: user.id,
          firstName: user.first_name,
          lastName: user.last_name,
          username: user.username,
          languageCode: user.language_code
        };
      }

      // Appel API avec la nouvelle route /link-manual
      const result = await api('/telegram/link-manual', {
        method: 'POST',
        body: {
          linkCode: linkCode.trim(),
          telegramData
        }
      });

      // Stocker la session retournée
      if (result.sessionKey) {
        localStorage.setItem('auth_token', result.sessionKey);
        window.dispatchEvent(new Event('storage'));
      }

      setStatus({ state: 'success', message: '✅ Telegram connecté avec succès !' });
    } catch (error) {
      console.error('[TelegramMiniApp] Manual link error:', error);
      setStatus({
        state: 'error',
        message: error?.message || 'Code invalide ou expiré.'
      });
    }
  }

  return (
    <section className="page-stack">
      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Telegram Mini App</p>
            <h2>Liaison du compte</h2>
          </div>
        </div>

        <div className="empty-card">
          {/* Loading */}
          {status.state === 'loading' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: 32,
                height: 32,
                border: '3px solid var(--accent-2)',
                borderTopColor: 'var(--accent)',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                margin: '0 auto 12px'
              }} />
              <p style={{ margin: 0 }}>{status.message}</p>
            </div>
          )}

          {/* Mode Manuel - Formulaire de code */}
          {(mode === 'manual' && status.state !== 'loading' && status.state !== 'success') && (
            <>
              <p style={{ marginBottom: 16 }}>
                {status.message || 'Entre ton code de liaison SKILL2CASH:'}
              </p>

              <form onSubmit={manualLink} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input
                  type="text"
                  value={linkCode}
                  onChange={(e) => setLinkCode(e.target.value)}
                  placeholder="Ex: ABC123XYZ"
                  style={{
                    padding: '12px 16px',
                    borderRadius: 8,
                    border: '1px solid var(--accent-2)',
                    background: 'var(--bg-1)',
                    color: 'var(--text)',
                    fontSize: 16,
                    textAlign: 'center',
                    letterSpacing: 2
                  }}
                  autoFocus
                />
                <button
                  type="submit"
                  className="primary-button"
                  disabled={!linkCode.trim() || status.state === 'loading'}
                >
                  {status.state === 'loading' ? 'Connexion...' : 'Connecter'}
                </button>
              </form>

              <div style={{ marginTop: 16, padding: 12, background: 'var(--bg-1)', borderRadius: 8 }}>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
                  <b>Où trouver ton code ?</b><br />
                  1. Va sur skill2cash.com<br />
                  2. Connecte-toi<br />
                  3. Profil → Paramètres → Telegram<br />
                  4. Clique "Connecter Telegram"<br />
                  5. Copie le code affiché
                </p>
              </div>
            </>
          )}

          {/* Besoin auth */}
          {status.state === 'needs_auth' && (
            <>
              <p style={{ marginBottom: 12 }}>{status.message}</p>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  const url = new URL(window.location.href);
                  url.searchParams.set('view', 'auth');
                  window.location.assign(url.toString());
                }}
              >
                Se connecter
              </button>
            </>
          )}

          {/* Erreur */}
          {status.state === 'error' && (
            <>
              <p style={{ color: 'var(--danger)', marginBottom: 12 }}>{status.message}</p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => window.location.reload()}
              >
                Réessayer
              </button>
            </>
          )}

          {/* Succès */}
          {status.state === 'success' && (
            <>
              <p style={{ color: 'var(--success)', marginBottom: 16, fontSize: 18 }}>
                {status.message}
              </p>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  const webApp = window.Telegram?.WebApp;
                  if (webApp?.close) {
                    webApp.close();
                  } else {
                    window.location.href = '/?view=profile';
                  }
                }}
              >
                Continuer
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
