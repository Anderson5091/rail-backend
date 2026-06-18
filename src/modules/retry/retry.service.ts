import { logger } from "../../utils/logger";

interface RetryJob {
  notificationId: string;
  channel: string;
  attemptCount: number;
}

class RetryService {
  private queue: RetryJob[] = [];
  private processing = false;
  private readonly MAX_RETRIES = 3;
  private readonly BASE_DELAY_MS = 2000;

  async enqueue(job: RetryJob): Promise<void> {
    this.queue.push(job);
    logger.info(`[RETRY] Enqueued notification ${job.notificationId} (attempt ${job.attemptCount})`);
    if (!this.processing) {
      this.processing = true;
      this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    while (this.queue.length > 0) {
      const job = this.queue.shift()!;
      const nextAttempt = job.attemptCount + 1;

      if (nextAttempt > this.MAX_RETRIES) {
        logger.error(`[RETRY] Max retries reached for notification ${job.notificationId}`);
        continue;
      }

      const delay = this.BASE_DELAY_MS * Math.pow(2, job.attemptCount);
      await new Promise((resolve) => setTimeout(resolve, delay));

      try {
        const { notificationOrchestrator } = await import("../notifications/notification.orchestrator");
        const { notificationRepository } = await import("../notifications/notification.repository");

        const [notifications] = await Promise.all([
          notificationRepository.findByUser(""),
        ]);

        logger.info(`[RETRY] Retrying notification ${job.notificationId} (attempt ${nextAttempt})`);
      } catch (error) {
        logger.error(`[RETRY] Retry failed for notification ${job.notificationId}`, error);
        this.queue.push({ ...job, attemptCount: nextAttempt });
      }
    }

    this.processing = false;
  }
}

export const retryService = new RetryService();
