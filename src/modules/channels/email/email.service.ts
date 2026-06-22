import { Resend } from "resend";
import { prisma } from "../../../config/database";
import { logger } from "../../../utils/logger";
import { templateEngine } from "../../templates/template.engine";
import type { NotificationResult } from "../../notifications/notification.types";

const resend =
  process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

const from = process.env.EMAIL_FROM || "Quick Send <noreply@quicksend.com.mx>";

class EmailService {
  async send(notification: NotificationResult): Promise<void> {
    if (!notification.userId) {
      logger.warn("[Email] No userId, skipping");
      return;
    }

    if (!resend) {
      logger.warn("[Email] Resend not configured, skipping");
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: notification.userId } });
    if (!user?.email) {
      logger.warn(`[Email] No email for user ${notification.userId}, skipping`);
      return;
    }

    const body = templateEngine.render("email", notification.type || "", {
      title: notification.title,
      message: notification.message,
    });

    const { error } = await resend.emails.send({
      from,
      to: user.email,
      subject: notification.title || "",
      html: body,
    });

    if (error) {
      logger.error(`[Email] Failed for ${user.email}: ${error.message}`);
      throw error;
    }

    logger.info(`[Email] Sent to ${user.email} for user ${notification.userId}`);
  }
}

export const emailService = new EmailService();
