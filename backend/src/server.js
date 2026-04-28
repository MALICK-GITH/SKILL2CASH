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
import { User } from './models/User.js';
import { ensureWallet } from './services/walletService.js';

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

  if (env.mongoUri === 'memory') {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@skill2cash.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123!';
    const existingAdmin = await User.findOne({ role: 'admin' });
    if (!existingAdmin) {
      const admin = await User.create({
        username: process.env.ADMIN_USERNAME || 'admin',
        efootballUsername: process.env.ADMIN_EFOOTBALL_USERNAME || 'admin',
        email: adminEmail,
        country: 'Côte d\'Ivoire',
        level: 'Elite',
        role: 'admin',
        passwordHash: await User.hashPassword(adminPassword),
        wins: 0,
        losses: 0,
        totalEarnings: 0,
        status: 'available',
        rank: 'Legend',
        badge: 'System Admin',
        avatar: 'https://api.dicebear.com/9.x/bottts/svg?seed=admin'
      });
      await ensureWallet(admin._id);
      console.log(`Memory admin ready: ${adminEmail} / ${adminPassword}`);
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
