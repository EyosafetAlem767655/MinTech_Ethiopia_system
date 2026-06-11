import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI || "";

declare global {
  // eslint-disable-next-line no-var
  var _mongoose: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null } | undefined;
}

const cached = global._mongoose ?? (global._mongoose = { conn: null, promise: null });

export async function dbConnect() {
  if (cached.conn) return cached.conn;
  if (!MONGODB_URI) throw new Error("MONGODB_URI is not set");
  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, { bufferCommands: false, maxPoolSize: 5 });
  }
  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }
  return cached.conn;
}
