// Vercel serverless entrypoint.
// Vercel detecta archivos en /api como funciones y los enruta automáticamente.
// El vercel.json reescribe TODAS las rutas a /api para que el Express app las resuelva.
import app from "../src/app.js";

export default app;
