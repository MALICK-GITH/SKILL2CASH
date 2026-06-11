import { AppError } from '../utils/AppError.js';

export function requireFields(fields) {
  return (req, _res, next) => {
    const missing = fields.filter((field) => req.body[field] === undefined || req.body[field] === '');
    if (missing.length) {
      throw new AppError(`Champs requis manquants: ${missing.join(', ')}`, 422);
    }
    next();
  };
}
