import twilio from "twilio";
import { prisma } from "../../../config/database";
import { logger } from "../../../utils/logger";
import type { NotificationResult } from "../../notifications/notification.types";

const twilioClient =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

const twilioFrom = process.env.TWILIO_PHONE_NUMBER || "";

class SmsService {
  async send(notification: NotificationResult): Promise<void> {
    if (!notification.userId) {
      logger.warn("[SMS] No userId, skipping");
      return;
    }

    if (!twilioClient || !twilioFrom) {
      logger.warn("[SMS] Twilio not configured, skipping");
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: notification.userId } });
    if (!user?.phone) {
      logger.warn(`[SMS] No phone for user ${notification.userId}, skipping`);
      return;
    }

    await twilioClient.messages.create({
      body: notification.message || notification.title || "",
      from: twilioFrom,
      to: user.phone,
    });

    logger.info(`[SMS] Sent to ${user.phone} for user ${notification.userId}`);
  }
}

export const smsService = new SmsService();
