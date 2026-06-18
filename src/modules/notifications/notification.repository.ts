import { prisma } from "../../config/database";
import type { CreateNotificationDto, NotificationResult } from "./notification.types";

export class NotificationRepository {
  async create(data: CreateNotificationDto): Promise<NotificationResult> {
    return prisma.notification.create({ data }) as unknown as NotificationResult;
  }

  async findByUser(userId: string, limit = 50): Promise<NotificationResult[]> {
    return prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    }) as unknown as NotificationResult[];
  }

  async findUnreadByUser(userId: string): Promise<NotificationResult[]> {
    return prisma.notification.findMany({
      where: { userId, status: { in: ["PENDING", "SENT"] } },
      orderBy: { createdAt: "desc" },
    }) as unknown as NotificationResult[];
  }

  async markAsRead(notificationId: string): Promise<void> {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: "READ" },
    });
  }

  async markAllAsRead(userId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { userId, status: { in: ["PENDING", "SENT"] } },
      data: { status: "READ" },
    });
  }

  async updateStatus(notificationId: string, status: string): Promise<void> {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { status },
    });
  }

  async createDelivery(data: {
    notificationId: string;
    provider: string;
    status: string;
    response?: Record<string, unknown>;
  }): Promise<void> {
    await prisma.notificationDelivery.create({
      data: {
        notificationId: data.notificationId,
        provider: data.provider,
        status: data.status,
        response: data.response || {},
        attemptCount: 0,
      },
    });
  }

  async countUnread(userId: string): Promise<number> {
    return prisma.notification.count({
      where: { userId, status: { in: ["PENDING", "SENT"] } },
    });
  }
}

export const notificationRepository = new NotificationRepository();
