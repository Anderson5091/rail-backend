import { prisma } from "../../config/database";

export class QueueService {
  async publish(queue: string, message: any) {
    console.log(`[Queue] Published to ${queue}:`, JSON.stringify(message));
  }

  async processPayouts() {
    const pending = await prisma.payoutOrder.findMany({
      where: { status: "PENDING" },
    });

    for (const order of pending) {
      await prisma.payoutOrder.update({
        where: { id: order.id },
        data: { status: "QUEUED" },
      });
    }
  }
}

export const queueService = new QueueService();
