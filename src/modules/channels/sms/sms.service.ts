import { logger } from "../../../utils/logger";
import type { NotificationResult } from "../../notifications/notification.types";

class SmsService {
  async send(notification: NotificationResult): Promise<void> {
    logger.info(`[SMS] To: ${notification.userId}, Message: ${notification.message}`);

    // In production, integrate with Twilio, Vonage, or similar:
    // await twilioClient.messages.create({ to: phone, from: FROM, body: message });
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export const smsService = new SmsService();
