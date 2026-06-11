import http from 'http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { connectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { seedDefaultCommissions } from './services/commissionService.js';
import { autoApproveEligibleDeposits } from './services/depositService.js';
import { recoverFromCrash, recoverMissingWithdrawalNotifications } from './services/recoveryService.js';
import { configureSocket } from './socket.js';
import { isAllowedOrigin } from './utils/origin.js';
import { upsertAdminAccount } from './services/adminBootstrapService.js';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { processDuelOcrInBackground, recoverStuckAnalyzingDuels } from './services/duelService.js';
import { processDepositOcrJob } from './services/depositService.js';
import { closeQueue } from './queues/duelOcrQueue.js';
import { closeDepositQueue } from './queues/depositOcrQueue.js';
import { initTelegramBot } from './bot/telegramBot.js';

let ocrWorker;
let depositOcrWorker;
let redisConnection;
let depositRedisConnection;

async function createRedisConnection(label) {
  const connection = new IORedis(env.redisUrl, {
    lazyConnect: true,
    connectTimeout: 2000,
    enableOfflineQueue: false,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: () => null,
    tls: env.redisUrl.startsWith('rediss://') ? {} : undefined
  });

  try {
    await connection.ping();
    return connection;
  } catch (error) {
    console.warn(`[${label}] Redis unavailable, worker disabled:`, error.message);
    try {
      connection.disconnect();
    } catch {
      // Ignore disconnect errors during startup probing.
    }
    return null;
  }
}

async function startOcrWorker() {
  redisConnection = await createRedisConnection('OCR Worker');
  if (!redisConnection) return;

  ocrWorker = new Worker(
    'duel-ocr',
    async (job) => {
      const { duelId } = job.data;
      console.log(`[OCR Worker] Processing duel ${duelId}`);
      await processDuelOcrInBackground(duelId);
      console.log(`[OCR Worker] Completed duel ${duelId}`);
    },
    {
      connection: redisConnection,
      concurrency: 2,
      limiter: { max: 10, duration: 60000 }
    }
  );

  ocrWorker.on('completed', (job) => {
    console.log(`[OCR Worker] Job ${job.id} completed`);
  });

  ocrWorker.on('failed', (job, err) => {
    console.error(`[OCR Worker] Job ${job?.id} failed:`, err.message);
  });

  ocrWorker.on('error', (err) => {
    console.error('[OCR Worker] Worker error:', err);
  });

  console.log('[OCR Worker] Started in-process worker');
}

async function startDepositOcrWorker() {
  depositRedisConnection = await createRedisConnection('Deposit OCR Worker');
  if (!depositRedisConnection) return;

  depositOcrWorker = new Worker(
    'deposit-ocr',
    async (job) => {
      const { depositId } = job.data;
      console.log(`[Deposit OCR Worker] Processing deposit ${depositId}`);
      await processDepositOcrJob(depositId);
      console.log(`[Deposit OCR Worker] Completed deposit ${depositId}`);
    },
    {
      connection: depositRedisConnection,
      concurrency: 2,
      limiter: { max: 20, duration: 60000 }
    }
  );

  depositOcrWorker.on('completed', (job) => {
    console.log(`[Deposit OCR Worker] Job ${job.id} completed`);
  });

  depositOcrWorker.on('failed', (job, err) => {
    console.error(`[Deposit OCR Worker] Job ${job?.id} failed:`, err.message);
  });

  depositOcrWorker.on('error', (err) => {
    console.error('[Deposit OCR Worker] Worker error:', err);
  });

  console.log('[Deposit OCR Worker] Started in-process worker');
}

async function main() {
  await connectDatabase();
  await seedDefaultCommissions();
  try {
    const recovery = await recoverFromCrash();
    console.log('Crash recovery completed:', recovery);
  } catch (error) {
    console.error('Crash recovery failed:', error.message);
  }
  try {
    const notificationRecovery = await recoverMissingWithdrawalNotifications();
    console.log('Withdrawal notification recovery completed:', notificationRecovery);
  } catch (error) {
    console.error('Withdrawal notification recovery failed:', error.message);
  }

  if (env.mongoUri === 'memory' || process.env.ADMIN_USERNAME || process.env.ADMIN_EMAIL || process.env.ADMIN_PASSWORD) {
    try {
      const result = await upsertAdminAccount({ createWallet: true });
      console.log(`${env.mongoUri === 'memory' ? 'Memory admin' : 'Admin'} ready: ${result.admin.email}`);
    } catch (error) {
      if (env.mongoUri === 'memory') {
        console.log('Memory admin not created. Set ADMIN_USERNAME, ADMIN_EMAIL and ADMIN_PASSWORD to enable one.');
      } else {
        throw error;
      }
    }
  }

  const app = createApp();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        if (isAllowedOrigin(origin, env.clientUrl ? new Set([env.clientUrl]) : new Set())) {
          callback(null, true);
          return;
        }
        callback(new Error(`Socket CORS blocked origin: ${origin}`));
      },
      credentials: true
    }
  });
  configureSocket(io);

  setInterval(() => {
    autoApproveEligibleDeposits().catch((error) => {
      console.error('Deposit auto-approval sweep failed:', error.message);
    });
  }, 60 * 1000);

  setInterval(() => {
    recoverStuckAnalyzingDuels().catch((error) => {
      console.error('OCR watchdog sweep failed:', error.message);
    });
  }, 2 * 60 * 1000); // 2 minutes (was 5)

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${env.port} is already in use. Stop the existing process or set a different PORT.`);
      process.exit(1);
    }
    throw error;
  });

  server.listen(env.port, () => {
    console.log(`SKILL2CASH API listening on http://localhost:${env.port}`);
  });

  if (process.env.SKILL2CASH_OCR_WORKER_MODE !== 'standalone') {
    await startOcrWorker();
    await startDepositOcrWorker();
  }

  // Initialize Telegram Bot
  initTelegramBot();
}

async function gracefulShutdown() {
  console.log('Shutting down gracefully...');
  if (ocrWorker) {
    await ocrWorker.close();
  }
  if (depositOcrWorker) {
    await depositOcrWorker.close();
  }
  try {
    await closeQueue();
  } catch (err) {
    // Queue may already be closed or not initialized
  }
  try {
    await closeDepositQueue();
  } catch (err) {
    // Queue may already be closed or not initialized
  }
  if (redisConnection) {
    try {
      await redisConnection.quit();
    } catch (err) {
      console.error('Error quitting Redis connection:', err.message);
    }
  }
  if (depositRedisConnection) {
    try {
      await depositRedisConnection.quit();
    } catch (err) {
      console.error('Error quitting deposit Redis connection:', err.message);
    }
  }
  process.exit(0);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
