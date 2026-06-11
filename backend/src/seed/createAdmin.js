import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { upsertAdminAccount } from '../services/adminBootstrapService.js';

async function createAdmin() {
  try {
    await connectDatabase();
    const result = await upsertAdminAccount({ createWallet: true });
    console.log(result.created ? 'Admin account created successfully.' : 'Admin account updated successfully.');
    console.log(`Email: ${result.admin.email}`);
    console.log('Change these credentials immediately after first login.');
    await disconnectDatabase();
  } catch (error) {
    console.error('Error creating admin:', error);
    process.exit(1);
  }
}

createAdmin();
