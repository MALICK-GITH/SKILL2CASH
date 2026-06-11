import React, { useState } from 'react';
import { ChevronRight, Eye, EyeOff, Loader2 } from 'lucide-react';
import { api } from '../api.js';
import { REGISTER_PHONE_PATTERN, REGISTER_USERNAME_PATTERN } from '../appShared.js';

export function AuthView({ mode, onModeChange, onSuccess, onBack }) {
  const [form, setForm] = useState({
    username: '',
    efootballUsername: '',
    firstName: '',
    lastName: '',
    phone: '',
    country: 'Global',
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
      if (mode === 'register') {
        if (!REGISTER_USERNAME_PATTERN.test(form.efootballUsername.trim())) {
          throw new Error('Le pseudo eFootball doit contenir 3 à 24 caractères et rester exact pour l’OCR.');
        }
        if (!REGISTER_USERNAME_PATTERN.test(form.username.trim())) {
          throw new Error('Le pseudo SKILL2CASH doit contenir 3 à 24 caractères valides.');
        }
        if (!REGISTER_PHONE_PATTERN.test(form.phone.trim())) {
          throw new Error('Le numéro de téléphone doit être valide pour les retraits et la vérification.');
        }
      }

      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      const payload = mode === 'login'
        ? { email: form.email, password: form.password }
        : {
          username: form.username.trim(),
          efootballUsername: form.efootballUsername.trim(),
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim(),
          country: form.country.trim() || 'Global',
          email: form.email.trim(),
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
            <button type="button" className={mode === 'login' ? 'tab is-active' : 'tab'} onClick={() => onModeChange('login')}>Connexion</button>
            <button type="button" className={mode === 'register' ? 'tab is-active' : 'tab'} onClick={() => onModeChange('register')}>Inscription</button>
          </div>
        </div>

        <h2>{mode === 'login' ? 'Accès rapide' : 'Créer ton compte'}</h2>
        <p className="muted">Le pseudo SKILL2CASH et le pseudo eFootball sont séparés. C'est ce second pseudo qui servira à la vérification OCR.</p>
        <p className="muted">Le téléphone sert aux retraits et le pseudo eFootball doit rester exact pour que les preuves OCR et les dépôts restent cohérents.</p>

        <form className="auth-form" onSubmit={submit}>
          {mode === 'register' && (
            <>
              <label>Pseudo SKILL2CASH<input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} placeholder="Ton pseudo SKILL2CASH" autoComplete="username" required /></label>
              <label>Pseudo eFootball exact<input value={form.efootballUsername} onChange={(event) => setForm((current) => ({ ...current, efootballUsername: event.target.value }))} placeholder="Pseudo exact eFootball" required /></label>
              <label>Prénom<input value={form.firstName} onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))} placeholder="Ton prénom" autoComplete="given-name" required /></label>
              <label>Nom<input value={form.lastName} onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))} placeholder="Ton nom" autoComplete="family-name" required /></label>
              <label>Téléphone<input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="+225..." autoComplete="tel" required /></label>
              <label>Pays / région<input value={form.country} onChange={(event) => setForm((current) => ({ ...current, country: event.target.value }))} placeholder="Global" autoComplete="country-name" /></label>
            </>
          )}

          <label>Adresse e-mail<input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="nom@exemple.com" autoComplete="email" required /></label>

          <label>
            Mot de passe
            <div className="password-field">
              <input type={showPassword ? 'text' : 'password'} value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder="Au moins 8 caractères" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
              <button type="button" className="password-toggle" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
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
