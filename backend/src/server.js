import http from 'http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { connectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { seedDefaultCommissions } from './services/commissionService.js';
import { configureSocket } from './socket.js';
import { isAllowedOrigin } from './utils/origin.js';

async function main() {
  await connectDatabase();
  await seedDefaultCommissions();

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

  server.listen(env.port, () => {
    console.log(`SKILL2CASH API listening on http://localhost:${env.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
