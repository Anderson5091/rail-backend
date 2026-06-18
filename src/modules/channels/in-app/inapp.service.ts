import { logger } from "../../../utils/logger";
import type { NotificationResult } from "../../notifications/notification.types";

// In-app notifications are already persisted by the notification repository.
// This service handles WebSocket broadcast so connected clients receive real-time updates.
class InAppService {
  async send(notification: NotificationResult): Promise<void> {
    logger.info(`[IN_APP] User: ${notification.userId}, Title: ${notification.title}`);

    // Broadcast to connected WebSocket clients
    const { broadcastToUser } = await import("../../../websocket/ws.handler");
    broadcastToUser(notification.userId!, {
      type: "NOTIFICATION",
      payload: notification,
    });
  }
}

export const inAppService = new InAppService();
