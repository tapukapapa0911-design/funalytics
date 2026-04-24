import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { connectToDatabase } from "./config/db.js";
import { startNavCron, triggerNavUpdate } from "./jobs/navUpdater.js";
import { logger } from "./utils/logger.js";

async function bootstrap() {
  await connectToDatabase();

  const app = createApp();
  app.listen(env.port, () => {
    logger.info(`Live NAV backend listening on port ${env.port}`);
  });

  startNavCron();

  try {
    await triggerNavUpdate();
  } catch (error) {
    logger.error("Initial NAV update failed", error.message);
  }
}

bootstrap().catch((error) => {
  logger.error("Server bootstrap failed", error);
  process.exit(1);
});
