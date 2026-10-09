const mongoose = require('mongoose');

mongoose.set('strictQuery', true);

// Cache the connection across serverless invocations (Vercel reuses warm instances).
let cached = global.__bumsMongo;
if (!cached) cached = global.__bumsMongo = { conn: null, promise: null, seeded: false };

async function connectDB() {
  if (cached.conn && mongoose.connection.readyState === 1) return cached.conn;
  if (!cached.promise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not configured');
    cached.promise = mongoose
      .connect(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 10 })
      .then(async (m) => {
        if (process.env.AUTO_SEED !== 'false' && !cached.seeded) {
          const { seedIfEmpty } = require('../seed/seed');
          await seedIfEmpty();
          cached.seeded = true;
        }
        return m;
      })
      .catch((err) => {
        cached.promise = null;
        throw err;
      });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

module.exports = { connectDB };
