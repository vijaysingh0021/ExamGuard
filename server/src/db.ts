import mongoose from 'mongoose';
import { loadConfig } from './config.js';

export async function connectDatabase() {
  const config = loadConfig();
  await mongoose.connect(config.MONGODB_URI, { dbName: config.MONGODB_DB_NAME, serverSelectionTimeoutMS: 15_000 });
  console.info(`MongoDB connected: ${mongoose.connection.name}`);
}
