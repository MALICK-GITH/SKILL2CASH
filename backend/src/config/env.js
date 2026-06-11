import dotenv from 'dotenv';

dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-me';

if (nodeEnv === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required in production');
}

if (nodeEnv === 'production' && !process.env.MONGO_URI) {
  throw new Error('MONGO_URI is required in production');
}

if (nodeEnv === 'production' && !process.env.REDIS_URL) {
  throw new Error('REDIS_URL is required in production');
}

export const env = {
  nodeEnv,
  port: Number(process.env.PORT || 5000),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/skill2cash',
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  clientUrl: process.env.CLIENT_URL || '',
  platformWalletId: process.env.PLATFORM_WALLET_ID || 'platform',
  aiBaseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  aiToken: process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || '',
  aiModel: process.env.ANTHROPIC_MODEL || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'claude-sonnet-4-20250514',
  aiMaxTokens: Number(process.env.ANTHROPIC_MAX_TOKENS || 700),
  aiAssistantRole: process.env.AI_ASSISTANT_ROLE || 'admin',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramWebhookUrl: process.env.TELEGRAM_WEBHOOK_URL || ''
};
