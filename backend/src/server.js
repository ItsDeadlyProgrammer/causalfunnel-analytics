import 'dotenv/config';
import mongoose from 'mongoose';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT) || 4000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/causalfunnel_analytics';

async function main() {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.syncIndexes();
  console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);

  const app = createApp();
  const server = app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));

  const shutdown = async () => {
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
