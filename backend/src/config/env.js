import dotenv from 'dotenv';

dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const jwtSecret = process.env.JWT_SECRET || 'render-fallback-jwt-secret-change-me';

if (nodeEnv === 'production' && !process.env.JWT_SECRET) {
  console.warn('JWT_SECRET is not set in production. Using a fallback secret until the environment variable is configured.');
}

if (nodeEnv === 'production' && !process.env.MONGO_URI) {
  console.warn('MONGO_URI is not set in production. Falling back to in-memory MongoDB until the environment variable is configured.');
}

export const env = {
  nodeEnv,
  port: Number(process.env.PORT || 5000),
  mongoUri: process.env.MONGO_URI || 'memory',
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  clientUrl: process.env.CLIENT_URL || '',
  platformWalletId: process.env.PLATFORM_WALLET_ID || 'platform',
  aiBaseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  aiToken: process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || '',
  aiModel: process.env.ANTHROPIC_MODEL || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'claude-sonnet-4-20250514',
  aiMaxTokens: Number(process.env.ANTHROPIC_MAX_TOKENS || 700)
};
