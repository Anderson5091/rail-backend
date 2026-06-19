import { httpServer } from "./app";
import { ENV } from "./config/env";
import { prisma } from "./config/database";
import { logger } from "./utils/logger";
import { setupWebSocket } from "./websocket/ws.handler";
import { retryWorker } from "./modules/retry/retry.worker";
import { registerEventHooks } from "./modules/events/event.hooks";
import { loggerService } from "./modules/production/observability/logger.service";
import { backupService } from "./modules/production/disaster-recovery/backup.service";
import { initializeTreasuryInfrastructure } from "./modules/treasury/treasury-initializer";
import { redisService } from "./services/redis.service";

async function main() {
  try {
    await prisma.$connect();
    logger.info("Database connected successfully");
    loggerService.info("Database connected", { service: "startup" });
  } catch (error) {
    logger.error("Failed to connect to database", error);
    loggerService.error("Database connection failed", { error });
    process.exit(1);
  }

  registerEventHooks();
  setupWebSocket(httpServer);

  await redisService.connect();

  retryWorker.start();

  initializeTreasuryInfrastructure();

  const isProduction = ENV.NODE_ENV === "production";
  if (isProduction) {
    loggerService.info("Running daily backup on startup", { service: "startup" });
    backupService.dailyBackup();

    setInterval(() => {
      backupService.dailyBackup();
    }, 24 * 60 * 60 * 1000);
  }

  httpServer.listen(ENV.PORT, () => {
    logger.info(`QuickSend API running on port ${ENV.PORT} in ${ENV.NODE_ENV} mode`);
    loggerService.info("Server started", { port: ENV.PORT, env: ENV.NODE_ENV });
  });
}

main().catch((error) => {
  logger.error("Failed to start server", error);
  loggerService.error("Server startup failed", { error });
  process.exit(1);
});
