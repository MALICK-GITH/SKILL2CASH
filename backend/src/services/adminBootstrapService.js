import { User } from '../models/User.js';
import { ensureWallet } from './walletService.js';

function requireAdminConfig() {
  const username = String(process.env.ADMIN_USERNAME || '').trim();
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  const firstName = String(process.env.ADMIN_FIRST_NAME || '').trim();
  const lastName = String(process.env.ADMIN_LAST_NAME || '').trim();
  const phone = String(process.env.ADMIN_PHONE || '').trim();
  const country = String(process.env.ADMIN_COUNTRY || "Cote d'Ivoire").trim();
  const level = String(process.env.ADMIN_LEVEL || 'Elite').trim();
  const efootballUsername = String(process.env.ADMIN_EFOOTBALL_USERNAME || username).trim();

  if (!username || !email || !password) {
    throw new Error('ADMIN_USERNAME, ADMIN_EMAIL and ADMIN_PASSWORD are required to create the admin account');
  }
  if (!firstName || !lastName || !phone) {
    throw new Error('ADMIN_FIRST_NAME, ADMIN_LAST_NAME and ADMIN_PHONE are required to create the admin account');
  }

  return { username, email, password, firstName, lastName, phone, country, level, efootballUsername };
}

export async function upsertAdminAccount({ createWallet = true } = {}) {
  const config = requireAdminConfig();
  const passwordHash = await User.hashPassword(config.password);

  const existing = await User.findOne({ email: config.email });
  if (existing) {
    existing.username = config.username;
    existing.firstName = config.firstName;
    existing.lastName = config.lastName;
    existing.efootballUsername = config.efootballUsername;
    existing.phone = config.phone;
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
    firstName: config.firstName,
    lastName: config.lastName,
    efootballUsername: config.efootballUsername,
    email: config.email,
    phone: config.phone,
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
