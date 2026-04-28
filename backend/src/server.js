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
    const adminUsername = process.env.ADMIN_USERNAME;
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const existingAdmin = await User.findOne({ role: 'admin' });
    if (!existingAdmin && adminUsername && adminEmail && adminPassword) {
      const admin = await User.create({
        username: adminUsername,
        efootballUsername: process.env.ADMIN_EFOOTBALL_USERNAME || adminUsername,
        email: adminEmail,
        country: "Cote d'Ivoire",
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
      console.log(`Memory admin ready: ${adminEmail}`);
    } else if (!existingAdmin) {
      console.log('Memory admin not created. Set ADMIN_USERNAME, ADMIN_EMAIL and ADMIN_PASSWORD to enable one.');
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
