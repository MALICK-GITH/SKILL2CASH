import mongoose from 'mongoose';
import dns from 'node:dns';
import { env } from './env.js';

let memoryServer;

function isLocalStandaloneMongoUri(uri) {
  return /^mongodb:\/\/(?:[^@/]+@)?(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/.test(uri) && !/[?&]replicaSet=/.test(uri);
}

async function startMemoryReplicaSet() {
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  memoryServer = await MongoMemoryReplSet.create({
    instanceOpts: [{ launchTimeout: 30000 }],
    replSet: { count: 1 }
  });
  console.log('MongoDB memory replica set started');
  return memoryServer.getUri();
}

export async function connectDatabase() {
  mongoose.set('strictQuery', true);
  let mongoUri = env.mongoUri;
  const usingMemory = mongoUri === 'memory';
  const useMemoryFallback = !usingMemory && env.nodeEnv !== 'production' && isLocalStandaloneMongoUri(mongoUri);

  if (usingMemory || useMemoryFallback) {
    mongoUri = await startMemoryReplicaSet();
  } else if (mongoUri.startsWith('mongodb+srv://')) {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  }

  const connectOptions = mongoUri.startsWith('mongodb+srv://')
    ? {
        serverApi: {
          version: '1',
          strict: true,
          deprecationErrors: true
        }
      }
    : {};

  await mongoose.connect(mongoUri, connectOptions);
  if (!usingMemory && !useMemoryFallback) {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    const supportsTransactions = Boolean(hello.setName || hello.msg === 'isdbgrid');
    if (!supportsTransactions) {
      throw new Error('MongoDB must run as a replica set or mongos because SKILL2CASH wallet operations require transactions. Use MongoDB Atlas or a local replica set.');
    }
  }
  console.log(`MongoDB connected: ${mongoose.connection.name}`);
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
}
