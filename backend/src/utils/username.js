import { AppError } from './AppError.js';

const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,24}$/;

export function normalizeUsername(value) {
  return String(value || '').trim();
}

export function validateEfootballUsername(value) {
  const username = normalizeUsername(value);
  if (!USERNAME_PATTERN.test(username)) {
    throw new AppError('Le nom d\'utilisateur eFootball doit comporter 3 à 24 caractères avec des lettres, chiffres, points, tirets ou underscores', 422);
  }
  return username;
}

export function usernameRegex(username) {
  return new RegExp(`^${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
}
