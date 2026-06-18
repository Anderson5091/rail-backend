import { logger } from "../../utils/logger";
import { notificationRepository } from "../notifications/notification.repository";
import { notificationOrchestrator } from "../notifications/notification.orchestrator";

const POLL_INTERVAL_MS = 10000;

export class RetryWorker {
  private intervalId: NodeJS.Timeout | null = null;

  start() {
    logger.info("[RETRY_WORKER] Starting retry worker...");
    this.intervalId = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async poll() {
    try {
      const deliveries = await prismaGetFailedDeliveries();

      for (const delivery of deliveries) {
        const notification = await notificationRepository.findByUser("");

        logger.info(`[RETRY_WORKER] Reprocessing failed delivery: ${delivery.id}`);
      }
    } catch (error) {
      logger.error("[RETRY_WORKER] Poll error", error);
    }
  }
}

async function prismaGetFailedDeliveries() {
  const { prisma } = await import("../../config/database");
  return prisma.notificationDelivery.findMany({
    where: { status: "FAILED" },
    take: 20,
  });
}

export const retryWorker = new RetryWorker();
