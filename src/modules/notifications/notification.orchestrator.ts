import { emailService } from "../channels/email/email.service";
import { smsService } from "../channels/sms/sms.service";
import { pushService } from "../channels/push/push.service";
import { inAppService } from "../channels/in-app/inapp.service";
import { retryService } from "../retry/retry.service";
import { notificationRepository } from "./notification.repository";
import { logger } from "../../utils/logger";
import type { NotificationResult } from "./notification.types";

class NotificationOrchestrator {
  async process(notification: NotificationResult): Promise<void> {
    try {
      const channel = notification.channel;

      switch (channel) {
        case "EMAIL":
          await emailService.send(notification);
          break;
        case "SMS":
          await smsService.send(notification);
          break;
        case "PUSH":
          await pushService.send(notification);
          break;
        case "IN_APP":
          await inAppService.send(notification);
          break;
        default:
          logger.warn(`Unknown notification channel: ${channel}`);
          return;
      }

      await notificationRepository.updateStatus(notification.id, "SENT");
      await notificationRepository.createDelivery({
        notificationId: notification.id,
        provider: channel.toLowerCase(),
        status: "SENT",
      });
    } catch (error) {
      logger.error(`Failed to send notification ${notification.id}`, error);
      await notificationRepository.updateStatus(notification.id, "FAILED");
      await notificationRepository.createDelivery({
        notificationId: notification.id,
        provider: notification.channel?.toLowerCase() || "unknown",
        status: "FAILED",
        response: { error: String(error) },
      });

      await retryService.enqueue({
        notificationId: notification.id,
        channel: notification.channel as string,
        attemptCount: 0,
      });
    }
  }
}

export const notificationOrchestrator = new NotificationOrchestrator();
