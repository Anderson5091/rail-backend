import { notificationRepository } from "./notification.repository";
import { notificationOrchestrator } from "./notification.orchestrator";
import type { CreateNotificationDto, NotificationResult } from "./notification.types";

export class NotificationService {
  async send(data: CreateNotificationDto): Promise<NotificationResult> {
    const notification = await notificationRepository.create(data);
    notificationOrchestrator.process(notification).catch(() => {});
    return notification;
  }

  async getUserNotifications(userId: string): Promise<NotificationResult[]> {
    return notificationRepository.findByUser(userId);
  }

  async getUnreadNotifications(userId: string): Promise<NotificationResult[]> {
    return notificationRepository.findUnreadByUser(userId);
  }

  async markAsRead(notificationId: string): Promise<void> {
    return notificationRepository.markAsRead(notificationId);
  }

  async markAllAsRead(userId: string): Promise<void> {
    return notificationRepository.markAllAsRead(userId);
  }

  async getUnreadCount(userId: string): Promise<number> {
    return notificationRepository.countUnread(userId);
  }
}

export const notificationService = new NotificationService();
