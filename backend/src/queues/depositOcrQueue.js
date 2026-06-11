import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env.js';

const connection = new IORedis(env.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  tls: env.redisUrl.startsWith('rediss://') ? {} : undefined
});

export const depositOcrQueue = new Queue('deposit-ocr', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 5000
    },
    removeOnComplete: {
      count: 100,
      age: 3600
    },
    removeOnFail: {
      count: 500,
      age: 86400
    }
  }
});

export async function enqueueDepositOcrJob(depositId) {
  await depositOcrQueue.add('process-deposit-ocr', { depositId }, {
    jobId: `deposit-ocr-${depositId}`,
    priority: 1
  });
}

export { connection };

export async function closeDepositQueue() {
  await depositOcrQueue.close();
  await connection.quit();
}
