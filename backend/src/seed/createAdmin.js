import { connectDatabase, disconnectDatabase } from '../config/database.js';
import '../config/env.js';
import { User } from '../models/User.js';
import { ensureWallet } from '../services/walletService.js';

const ADMIN_CONFIG = {
  username: process.env.ADMIN_USERNAME || 'admin',
  email: process.env.ADMIN_EMAIL || 'admin@skill2cash.com',
  password: process.env.ADMIN_PASSWORD,
  country: process.env.ADMIN_COUNTRY || 'Cote d Ivoire',
  level: process.env.ADMIN_LEVEL || 'Elite',
  role: 'admin'
};

export async function createAdmin() {
  try {
    if (!ADMIN_CONFIG.password) {
      throw new Error('ADMIN_PASSWORD is required to create the admin account');
    }

    await connectDatabase();

    const existing = await User.findOne({ email: ADMIN_CONFIG.email });
    if (existing) {
      console.log(`Admin already exists: ${existing.email}`);
      await disconnectDatabase();
      return;
    }

    const admin = await User.create({
      username: ADMIN_CONFIG.username,
      email: ADMIN_CONFIG.email,
      country: ADMIN_CONFIG.country,
      level: ADMIN_CONFIG.level,
      role: ADMIN_CONFIG.role,
      passwordHash: await User.hashPassword(ADMIN_CONFIG.password),
      wins: 0,
      losses: 0,
      totalEarnings: 0,
      status: 'available',
      rank: 'Legend',
      badge: 'System Admin',
      avatar: 'https://api.dicebear.com/9.x/bottts/svg?seed=admin'
    });

    await ensureWallet(admin._id);

    console.log('Admin account created successfully.');
    console.log(`Email: ${ADMIN_CONFIG.email}`);
    console.log(`Password: ${ADMIN_CONFIG.password}`);
    console.log('Change these credentials immediately after first login.');

    await disconnectDatabase();
  } catch (error) {
    console.error('Error creating admin:', error);
    process.exit(1);
  }
}

createAdmin();
