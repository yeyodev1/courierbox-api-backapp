import "dotenv/config";
import { dbConnect } from "./db/mongo";
import { env } from "./config/env";
import { createApp } from "./app";
import { ensureSuperadminUser } from "./services/bootstrap.service";
const port = process.env.PORT || 8101;
const { app, server } = createApp();

async function bootstrap() {
  await dbConnect();
  await ensureSuperadminUser();
}

bootstrap().catch((error) => {
  console.error("Failed during startup bootstrap:", error);
});

// For Vercel/serverless environments, we export the app.
// For local development, we listen on the configured port.
if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  server.timeout = 10 * 60 * 1000;
  server.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

export default app;
