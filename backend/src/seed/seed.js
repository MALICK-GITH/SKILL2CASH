import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { seedDefaultCommissions } from '../services/commissionService.js';

async function seed() {
  await connectDatabase();
  await seedDefaultCommissions();
  console.log('Seed complete. Commission settings are ready.');
  await disconnectDatabase();
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
