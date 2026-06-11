import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env.js';
import { processDuelOcrInBackground } from '../services/duelService.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';

const connection = new IORedis(env.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  tls: env.redisUrl.startsWith('rediss://') ? {} : undefined
});

const worker = new Worker(
  'duel-ocr',
  async (job) => {
    const { duelId } = job.data;
    console.log(`[OCR Worker] Processing duel ${duelId}`);
    await processDuelOcrInBackground(duelId);
    console.log(`[OCR Worker] Completed duel ${duelId}`);
  },
  {
    connection,
    concurrency: 2,
    limiter: {
      max: 10,
      duration: 60000
    }
  }
);

worker.on('completed', (job) => {
  console.log(`[OCR Worker] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[OCR Worker] Job ${job?.id} failed:`, err.message);
});

worker.on('error', (err) => {
  console.error('[OCR Worker] Worker error:', err);
});

async function gracefulShutdown() {
  console.log('[OCR Worker] Shutting down gracefully...');
  await worker.close();
  await connection.quit();
  await disconnectDatabase();
  process.exit(0);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function start() {
  await connectDatabase();
  console.log('[OCR Worker] Started and connected to Redis + MongoDB');
}

start().catch((err) => {
  console.error('[OCR Worker] Failed to start:', err);
  process.exit(1);
});
