import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { User } from '../models/User.js';
import { Wallet } from '../models/Wallet.js';
import mongoose from 'mongoose';

// Critères pour identifier les comptes démos/test
const DEMO_PATTERNS = [
  /test/i,
  /demo/i,
  /example/i,
  /sample/i,
  /skill2cash\.test/i,
  /testplayer/i,
  /p1_/i,
  /p2_/i,
  /wjwbsi/i,
  /aiso/i
];

async function cleanupDemoUsers() {
  await connectDatabase();
  console.log('🔍 Recherche des comptes démos...');

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Trouver tous les utilisateurs qui correspondent aux critères de démo
    const demoUsers = await User.find({
      $or: [
        ...DEMO_PATTERNS.map(pattern => ({ email: { $regex: pattern } })),
        ...DEMO_PATTERNS.map(pattern => ({ username: { $regex: pattern } })),
        ...DEMO_PATTERNS.map(pattern => ({ efootballUsername: { $regex: pattern } }))
      ]
    }).session(session);

    if (demoUsers.length === 0) {
      console.log('✅ Aucun compte démo trouvé.');
      await session.abortTransaction();
      await disconnectDatabase();
      return;
    }

    console.log(`📊 ${demoUsers.length} comptes démos trouvés:`);
    demoUsers.forEach(user => {
      console.log(`  - ${user.username} (${user.email})`);
    });

    // Supprimer les wallets associés
    const userIds = demoUsers.map(u => u._id);
    const walletDeleteResult = await Wallet.deleteMany({ user: { $in: userIds } }).session(session);
    console.log(`🗑️  ${walletDeleteResult.deletedCount} wallets supprimés`);

    // Supprimer les utilisateurs
    const userDeleteResult = await User.deleteMany({ _id: { $in: userIds } }).session(session);
    console.log(`🗑️  ${userDeleteResult.deletedCount} utilisateurs supprimés`);

    await session.commitTransaction();
    console.log('✅ Nettoyage terminé avec succès');
  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Erreur lors du nettoyage:', error);
    throw error;
  } finally {
    await session.endSession();
    await disconnectDatabase();
  }
}

cleanupDemoUsers().catch((error) => {
  console.error(error);
  process.exit(1);
});
