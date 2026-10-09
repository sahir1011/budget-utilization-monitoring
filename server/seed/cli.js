// Usage: MONGODB_URI=... node server/seed/cli.js [--reset]
// --reset drops all collections first. Without it, seeding only runs on an empty database.
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI (e.g. in .env) before seeding');
  process.env.AUTO_SEED = 'false';
  await mongoose.connect(process.env.MONGODB_URI);
  const { seedDatabase, seedIfEmpty } = require('./seed');
  if (process.argv.includes('--reset')) {
    console.log(`Dropping database "${mongoose.connection.name}"…`);
    await mongoose.connection.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    await seedDatabase();
  } else if (!(await seedIfEmpty())) {
    console.log('Database already has data. Re-run with --reset to wipe and reseed.');
  }
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
