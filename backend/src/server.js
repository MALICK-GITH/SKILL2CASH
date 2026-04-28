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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
