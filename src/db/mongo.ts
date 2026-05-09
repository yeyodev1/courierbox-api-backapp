// Persistencia deshabilitada por ahora.
// Cuando quieras activar Mongo:
//   1. pnpm add mongoose
//   2. Descomenta el bloque y exporta connectMongo desde app.ts
//
// import mongoose from "mongoose";
// import { logger } from "../utils/logger.js";
//
// export async function connectMongo(uri: string): Promise<void> {
//   mongoose.set("strictQuery", true);
//   await mongoose.connect(uri);
//   logger.info("[mongo] connected");
// }

export async function connectMongo(_uri?: string): Promise<void> {
  // no-op: sin DB por ahora
}
