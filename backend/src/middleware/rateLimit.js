/**
 * Rate Limiting Middleware
 * Prevents brute force and DoS attacks
 * @author SOLITAIRE HACK
 */

import rateLimit from 'express-rate-limit';

// General API rate limit
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Trop de requêtes, veuillez réessayer plus tard'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health' || req.path === '/api/health';
  }
});

// Strict limit for auth endpoints
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per 15 minutes
  message: {
    success: false,
    message: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Create duel/challenge limiter
export const createActionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 creations per minute
  message: {
    success: false,
    message: 'Trop d\'actions créées. Veuillez ralentir.'
  }
});

// Withdrawal limiter (more strict)
export const withdrawalLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 withdrawals per hour
  message: {
    success: false,
    message: 'Limite de retraits atteinte. Maximum 3 retraits par heure.'
  }
});

// Deposit limiter
export const depositLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // 10 deposits per 5 minutes
  message: {
    success: false,
    message: 'Trop de dépôts. Veuillez patienter quelques minutes.'
  }
});
