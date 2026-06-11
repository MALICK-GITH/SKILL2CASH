import React from 'react';
import { ChevronRight } from 'lucide-react';
import { WHATSAPP_GROUP_URL } from '../appShared.js';

export function Landing({ onEnter, onRegister }) {
  return (
    <section className="landing">
      <div className="landing-copy">
        <p className="eyebrow">Conçu pour tous les écrans</p>
        <h1>SKILL2CASH</h1>
        <p className="landing-text">
          Une interface claire pour gérer ton portefeuille, lancer des duels eFootball et suivre chaque validation, du téléphone au grand écran.
        </p>
        <div className="landing-community">
          <p className="landing-community-label">Communauté WhatsApp</p>
          <p className="landing-community-text">
            Rejoins le groupe pour parler avec les joueurs, signaler un souci et organiser les défis.
          </p>
          <a className="primary-button landing-community-button" href={WHATSAPP_GROUP_URL} target="_blank" rel="noreferrer">
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
      </div>

      <div className="landing-grid">
        <article className="feature-card">
          <strong>1. Déposer</strong>
          <p>Paiement Wave ou MTN, preuve obligatoire, validation côté serveur.</p>
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
