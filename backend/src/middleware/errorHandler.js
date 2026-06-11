import { AppError } from '../utils/AppError.js';

export function notFound(req, _res, next) {
  next(new AppError(`Ressource introuvable : ${req.method} ${req.originalUrl}`, 404));
}

export function errorHandler(err, _req, res, _next) {
  const statusCode = err.statusCode || 500;
  const isProd = process.env.NODE_ENV === 'production';
  const message = statusCode === 500
    ? 'Une erreur interne est survenue. Notre équipe en a été informée. Réessaie dans quelques instants.'
    : err.message;

  if (statusCode === 500) {
    console.error(err);
  }

  res.status(statusCode).json({
    message,
    ...(!isProd && { details: err.message })
  });
}
