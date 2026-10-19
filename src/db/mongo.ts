import mongoose from "mongoose";

/**
 * Conexión a Mongo pensada para Vercel. Antes un fallo al conectar en el
 * arranque en frío (Atlas responde "SystemOverloaded" o no elige primario a
 * tiempo) hacía `process.exit(1)`: Vercel devolvía un 500 sin CORS y el
 * navegador lo mostraba como "no pudimos conectarnos con el servidor".
 * Ahora se reintenta, la instancia sigue viva y cada petición espera la
 * conexión (o recibe un 503 claro si de verdad no hay base de datos).
 */
let conexion: Promise<typeof mongoose> | null = null;

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function conectarConReintentos(uri: string, intentos = 3) {
  let ultimo: unknown;
  for (let i = 1; i <= intentos; i++) {
    try {
      const m = await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5_000,
        // Cada instancia serverless abre su propio pool: pocas conexiones por
        // instancia para no agotar el límite del cluster.
        maxPoolSize: 5,
      });
      console.log(`Connected to MongoDB${i > 1 ? ` (intento ${i})` : ""}`);
      return m;
    } catch (error) {
      ultimo = error;
      console.error(`MongoDB connection error (intento ${i}/${intentos}):`, error);
      if (i < intentos) await espera(500 * i);
    }
  }
  throw ultimo;
}

/** La conexión compartida; si el último intento falló, la próxima llamada vuelve a probar. */
export function ensureDb() {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose);
  if (!conexion) {
    const DB_URI = process.env.DB_URI;
    if (!DB_URI) return Promise.reject(new Error("DB_URI is not defined in environment variables"));
    conexion = conectarConReintentos(DB_URI).catch((error) => {
      conexion = null;
      throw error;
    });
  }
  return conexion;
}

export async function dbConnect() {
  await ensureDb();
}
