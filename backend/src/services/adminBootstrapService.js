import { User } from '../models/User.js';
import { ensureWallet } from './walletService.js';

function requireAdminConfig() {
  const username = String(process.env.ADMIN_USERNAME || '').trim();
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  const country = String(process.env.ADMIN_COUNTRY || "Cote d'Ivoire").trim();
  const level = String(process.env.ADMIN_LEVEL || 'Elite').trim();
  const efootballUsername = String(process.env.ADMIN_EFOOTBALL_USERNAME || username).trim();

  if (!username || !email || !password) {
    throw new Error('ADMIN_USERNAME, ADMIN_EMAIL and ADMIN_PASSWORD are required to create the admin account');
  }

  return { username, email, password, country, level, efootballUsername };
}

export async function upsertAdminAccount({ createWallet = true } = {}) {
  const config = requireAdminConfig();
  const passwordHash = await User.hashPassword(config.password);

  const existing = await User.findOne({ email: config.email });
  if (existing) {
    existing.username = config.username;
    existing.efootballUsername = config.efootballUsername;
    existing.role = 'admin';
    existing.country = config.country;
    existing.level = config.level;
    existing.passwordHash = passwordHash;
    existing.status = existing.status || 'available';
    existing.rank = 'Legend';
    existing.badge = 'System Admin';
    existing.avatar = existing.avatar || 'https://api.dicebear.com/9.x/bottts/svg?seed=admin';
    await existing.save();
    if (createWallet) {
      await ensureWallet(existing._id);
    }
    return { admin: existing, created: false };
  }

  const admin = await User.create({
    username: config.username,
    efootballUsername: config.efootballUsername,
    email: config.email,
    country: config.country,
    level: config.level,
    role: 'admin',
    passwordHash,
    wins: 0,
    losses: 0,
    totalEarnings: 0,
    status: 'available',
    rank: 'Legend',
    badge: 'System Admin',
    avatar: 'https://api.dicebear.com/9.x/bottts/svg?seed=admin'
  });

  if (createWallet) {
    await ensureWallet(admin._id);
  }

  return { admin, created: true };
}
