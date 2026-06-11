/**
 * Validation Utilities
 * Prevents NoSQL injection and validates inputs
 * @author SOLITAIRE HACK
 */

import mongoose from 'mongoose';
import { AppError } from './AppError.js';

/**
 * Validates if a string is a valid MongoDB ObjectId
 * @param {string} id - The id to validate
 * @param {string} fieldName - Name of the field for error messages
 * @returns {boolean} - True if valid
 * @throws {AppError} - If invalid
 */
export function validateObjectId(id, fieldName = 'ID') {
  if (!id) {
    throw new AppError(`${fieldName} requis`, 400);
  }

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(`${fieldName} invalide`, 400);
  }

  return true;
}

/**
 * Sanitizes a string to prevent NoSQL injection
 * @param {string} str - String to sanitize
 * @returns {string} - Sanitized string
 */
export function sanitizeString(str) {
  if (typeof str !== 'string') return '';

  // Remove NoSQL operators
  return str
    .replace(/\$|\{|\}/g, '')
    .trim();
}

/**
 * Validates and sanitizes pagination params
 * @param {Object} params - Query params
 * @returns {Object} - Sanitized { page, limit }
 */
export function validatePagination(params = {}) {
  let page = parseInt(params.page, 10) || 1;
  let limit = parseInt(params.limit, 10) || 20;

  // Enforce limits
  page = Math.max(1, page);
  limit = Math.min(100, Math.max(1, limit)); // Max 100 items per page

  return { page, limit };
}

/**
 * Validates amount is a positive number
 * @param {number} amount - Amount to validate
 * @param {string} fieldName - Field name for error
 * @returns {number} - Validated amount
 * @throws {AppError} - If invalid
 */
export function validateAmount(amount, fieldName = 'Montant') {
  const num = Number(amount);

  if (!Number.isFinite(num) || num <= 0) {
    throw new AppError(`${fieldName} invalide`, 400);
  }

  // Round to 2 decimal places
  return Math.round(num * 100) / 100;
}

/**
 * Validates phone number format
 * @param {string} phone - Phone number
 * @returns {boolean} - True if valid
 */
export function validatePhone(phone) {
  // Basic validation for African phone numbers
  const phoneRegex = /^\+?[0-9]{8,15}$/;
  return phoneRegex.test(String(phone).replace(/\s/g, ''));
}

/**
 * Validates email format
 * @param {string} email - Email to validate
 * @returns {boolean} - True if valid
 */
export function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(String(email).toLowerCase());
}

/**
 * Middleware to validate ObjectId in params
 * @param {string} paramName - Parameter name to validate
 */
export function validateParamId(paramName) {
  return (req, res, next) => {
    try {
      validateObjectId(req.params[paramName], paramName);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Checks if value contains NoSQL injection patterns
 * @param {*} value - Value to check
 * @returns {boolean} - True if suspicious
 */
export function containsNoSQLInjection(value) {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const dangerousKeys = [
    '$where', '$ne', '$gt', '$lt', '$gte', '$lte', '$in', '$nin', '$regex', '$options',
    '$or', '$and', '$not', '$nor', '$exists', '$expr', '$elemMatch', '$all', '$size',
    '$eq', '$mod', '$type', '$text', '$search', '$match', '$project', '$group',
    '$sum', '$avg', '$min', '$max', '$push', '$addToSet', '$first', '$last'
  ];

  const checkObject = (obj) => {
    for (const key of Object.keys(obj)) {
      if (dangerousKeys.some(dk => key.includes(dk))) {
        return true;
      }
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        if (checkObject(obj[key])) {
          return true;
        }
      }
    }
    return false;
  };

  return checkObject(value);
}
