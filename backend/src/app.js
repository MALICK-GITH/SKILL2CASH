import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { adminRouter } from './routes/adminRoutes.js';
import { assistantRouter } from './routes/assistantRoutes.js';
import arbitrationRouter from './routes/arbitrationRoutes.js';
import { authRouter } from './routes/authRoutes.js';
import { challengeRouter } from './routes/challengeRoutes.js';
import chatMessageRouter from './routes/chatMessageRoutes.js';
import { duelRouter } from './routes/duelRoutes.js';
import gameProfileRouter from './routes/gameProfileRoutes.js';
import gameRouter from './routes/gameRoutes.js';
import { leaderboardRouter } from './routes/leaderboardRoutes.js';
import { notificationRouter } from './routes/notificationRoutes.js';
import platformRouter from './routes/platformRoutes.js';
import publicInvitationRouter from './routes/publicInvitationRoutes.js';
import roomRouter from './routes/roomRoutes.js';
import streamRouter from './routes/streamRoutes.js';
import telegramRouter from './routes/telegramRoutes.js';
import { userRouter } from './routes/userRoutes.js';
import { walletRouter } from './routes/walletRoutes.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { isAllowedOrigin } from './utils/origin.js';

export function createApp() {
  const app = express();
  const frontendDist = path.resolve(process.cwd(), '../frontend/dist');
  const frontendIndex = path.join(frontendDist, 'index.html');
  const allowedOrigins = env.clientUrl ? new Set([env.clientUrl]) : new Set();
  const corsOrigin = (origin, callback) => {
    if (env.nodeEnv === 'development' || isAllowedOrigin(origin, allowedOrigins)) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS blocked origin: ${origin}`));
  };

  app.use(helmet());
  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 250, standardHeaders: true, legacyHeaders: false }));
  if (fs.existsSync(frontendIndex)) {
    app.use(express.static(frontendDist));
    app.get('/', (_req, res) => res.sendFile(frontendIndex));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(frontendIndex);
    });
  } else {
    app.get('/', (_req, res) => res.json({
      name: 'SKILL2CASH API',
      version: '1.0.0',
      health: '/api/health',
      endpoints: {
        auth: '/api/auth',
        users: '/api/users',
        wallet: '/api/wallet',
        challenges: '/api/challenges',
        duels: '/api/duels',
        leaderboard: '/api/leaderboard',
        admin: '/api/admin',
        assistant: '/api/assistant',
        games: '/api/games',
        platforms: '/api/platforms',
        gameProfiles: '/api/game-profiles',
        rooms: '/api/rooms',
        streams: '/api/streams',
        arbitrations: '/api/arbitrations',
        publicInvitations: '/api/public-invitations',
        chatMessages: '/api/chat-messages',
        telegram: '/api/telegram'
      }
    }));
  }
  app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'SKILL2CASH API' }));
  app.use('/api/auth', authRouter);
  app.use('/api/users', userRouter);
  app.use('/api/wallet', walletRouter);
  app.use('/api/challenges', challengeRouter);
  app.use('/api/duels', duelRouter);
  app.use('/api/leaderboard', leaderboardRouter);
  app.use('/api/notifications', notificationRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/assistant', assistantRouter);
  app.use('/api/games', gameRouter);
  app.use('/api/platforms', platformRouter);
  app.use('/api/game-profiles', gameProfileRouter);
  app.use('/api/rooms', roomRouter);
  app.use('/api/streams', streamRouter);
  app.use('/api/arbitrations', arbitrationRouter);
  app.use('/api/public-invitations', publicInvitationRouter);
  app.use('/api/telegram', telegramRouter);
  app.use('/api/chat-messages', chatMessageRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
