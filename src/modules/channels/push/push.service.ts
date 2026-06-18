import { logger } from "../../../utils/logger";
import type { NotificationResult } from "../../notifications/notification.types";

class PushService {
  async send(notification: NotificationResult): Promise<void> {
    logger.info(`[PUSH] To: ${notification.userId}, Title: ${notification.title}`);

    // In production, integrate with Firebase Cloud Messaging:
    // await admin.messaging().send({ token, notification: { title, body } });
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export const pushService = new PushService();
