import { logger } from "../../../utils/logger";
import { templateEngine } from "../../templates/template.engine";
import type { NotificationResult } from "../../notifications/notification.types";

class EmailService {
  async send(notification: NotificationResult): Promise<void> {
    const body = templateEngine.render("email", notification.type || "", {
      title: notification.title,
      message: notification.message,
    });

    logger.info(`[EMAIL] To: ${notification.userId}, Subject: ${notification.title}`);
    logger.info(`[EMAIL] Body: ${body}`);

    // In production, integrate with SendGrid, SES, or similar:
    // await sendgridClient.send({ to, subject, html: body });
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export const emailService = new EmailService();
