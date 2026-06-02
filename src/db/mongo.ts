import mongoose from "mongoose";
import { logger } from "../utils/logger.js";

export async function connectMongo(uri: string): Promise<void> {
  try {
    mongoose.set("strictQuery", true);
    await mongoose.connect(uri);
    logger.info("[mongo] connected successfully");
  } catch (error) {
    logger.error("[mongo] connection error:", { error: String(error) });
    throw error;
  }
}
