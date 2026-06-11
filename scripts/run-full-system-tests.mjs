import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import process from 'node:process';

const ROOT_DIR = process.cwd();
const BACKEND_DIR = path.join(ROOT_DIR, 'backend');
// Avoid clashing with dev server (commonly 5001 in this repo).
const DEFAULT_PORT = 5101;

async function findFreePort(startPort = DEFAULT_PORT, attempts = 20) {
  for (let i = 0; i < attempts; i += 1) {
    const port = startPort + i;
    const free = await new Promise((resolve) => {
      const server = net.createServer();
      server.unref();
      server.once('error', () => resolve(false));
      // Bind on all interfaces to detect conflicts reliably.
      server.listen(port, () => {
        server.close(() => resolve(true));
      });
    });
    if (free) return port;
  }
  throw new Error(`No free port found starting at ${startPort}`);
}

function startProcess(command, args, options = {}) {
  return spawn(command, args, {
    cwd: options.cwd || ROOT_DIR,
    env: { ...process.env, ...options.env },
    stdio: options.stdio || 'inherit',
    windowsHide: true,
    shell: false
  });
}

async function waitForBackend(url, timeoutMs = 120000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await delay(2000);
  }
  throw new Error(`Backend did not become ready within ${timeoutMs}ms`);
}

async function hasLocalMongo(port = 27017) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(800);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function run() {
  const portNumber = await findFreePort(DEFAULT_PORT);
  const PORT = String(portNumber);
  const API_URL = `http://localhost:${PORT}/api`;
  console.log(`Using PORT=${PORT} for full-system tests`);
  const mongoUri = (await hasLocalMongo())
    ? `mongodb://127.0.0.1:27017/skill2cash_fulltest_${Date.now()}`
    : 'memory';

  const backend = startProcess('node', ['src/server.js'], {
    cwd: BACKEND_DIR,
    env: {
      PORT,
      MONGO_URI: mongoUri,
      ADMIN_USERNAME: 'solitaireone',
      ADMIN_EMAIL: 'admin@skill2cash.test',
      ADMIN_PASSWORD: 'password123',
      ADMIN_FIRST_NAME: 'Solo',
      ADMIN_LAST_NAME: 'Test',
      ADMIN_PHONE: '+221700000000',
      ADMIN_COUNTRY: 'Cote d\'Ivoire',
      ADMIN_LEVEL: 'Elite',
      ADMIN_EFOOTBALL_USERNAME: 'SOLITAIREHACK'
    },
    stdio: 'inherit'
  });

  let backendStopped = false;
  const stopBackend = async () => {
    if (backendStopped) return;
    backendStopped = true;
    if (!backend.killed) {
      backend.kill('SIGTERM');
      await delay(1000);
      if (!backend.killed) backend.kill('SIGKILL');
    }
  };

  try {
    await waitForBackend(`${API_URL.replace(/\/api$/, '')}/api/health`);

    const scenario = startProcess('node', ['test_full_scenarios.js'], {
      env: {
        API_URL,
        ADMIN_EMAIL: 'admin@skill2cash.test',
        ADMIN_PASSWORD: 'password123'
      }
    });

    const exitCode = await new Promise((resolve) => {
      scenario.on('exit', resolve);
    });

    if (exitCode !== 0) {
      throw new Error(`Full system scenarios failed with exit code ${exitCode}`);
    }
  } finally {
    await stopBackend();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
