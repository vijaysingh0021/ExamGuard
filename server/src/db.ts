import mongoose from 'mongoose';
import { loadConfig } from './config.js';

export async function connectDatabase() {
  const config = loadConfig();
  await mongoose.connect(config.MONGODB_URI, { dbName: config.MONGODB_DB_NAME });
  console.info(`MongoDB Atlas connected: ${mongoose.connection.name}`);
}
