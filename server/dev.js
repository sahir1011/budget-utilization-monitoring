// Local development server. Uses MONGODB_URI from .env when set; otherwise starts an
// in-memory MongoDB (mongodb-memory-server) so the app runs with zero setup.
require('dotenv').config({ quiet: true });

async function main() {
  if (!process.env.MONGODB_URI) {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    const mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri('bums');
    console.log('Using in-memory MongoDB (data resets on restart). Set MONGODB_URI in .env to persist.');
  }
  const { createApp } = require('./app');
  const { connectDB } = require('./config/db');
  await connectDB();
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`API listening on http://localhost:${port}/api`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
